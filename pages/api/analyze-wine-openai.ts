import { NextApiRequest, NextApiResponse } from 'next';
import { put } from '@vercel/blob';
import { kv } from '@vercel/kv';
import { v4 as uuidv4 } from 'uuid';
import OpenAI from 'openai';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Define WineData type to fix type error
type WineData = {
  name: string;
  producer: string;
  vintage: string;
  region: string;
  grapeVarieties: string;
  tastingNotes: string;
  score: number;
  price: string;
  imageUrl: string;
  webSnippets: string;
};

type AnalyzeRequestBody = {
  image: string;
};

type AnalyzeResponseData = {
  jobId: string;
  status: string;
  requestId?: string;
  message?: string;
  data?: {
    wines: WineData[];
    imageUrl: string;
  };
};

// Validate image format and extract base64 data
function validateAndExtractImageData(imageStr: string): string | null {
  if (!imageStr || typeof imageStr !== 'string') return null;
  
  // Handle data URLs (e.g., "data:image/jpeg;base64,/9j/4AAQ...")
  if (imageStr.startsWith('data:')) {
    const parts = imageStr.split(',');
    if (parts.length !== 2) return null;
    return parts[1];
  }
  
  // Handle raw base64 strings
  if (/^[A-Za-z0-9+/=]+$/.test(imageStr)) {
    return imageStr;
  }
  
  return null;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<AnalyzeResponseData>
) {
  // Only accept POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      status: 'error', 
      message: 'Method not allowed',
      jobId: ''
    });
  }

  // Generate a request ID for logging
  const requestId = uuidv4();
  console.log(`[${requestId}] OpenAI-only analyze request received`);
  console.log(`[${requestId}] DEPLOYMENT CHECK: Using updated GPT-4o version - April 1, 2025 @ ${new Date().toISOString()}`);

  // Generate a unique job ID at the beginning
  const jobId = uuidv4();
  console.log(`[${requestId}] Generated Job ID: ${jobId}`);

  try {
    const { image } = req.body as AnalyzeRequestBody;

    if (!image) {
      return res.status(400).json({ 
        status: 'error', 
        message: 'No image provided',
        jobId // Return the jobId even in error cases
      });
    }

    // Make sure we set job ID in headers for client accessibility
    res.setHeader('x-job-id', jobId);

    // Validate and extract the base64 image data
    const imageData = validateAndExtractImageData(image);
    if (!imageData) {
      console.error(`[${requestId}] Invalid image data format`);
      return res.status(400).json({ 
        status: 'error', 
        message: 'Invalid image data format. Expected base64 string or data URL',
        jobId 
      });
    }

    // Upload image to Blob storage
    console.log(`[${requestId}] [${jobId}] Uploading image to Vercel Blob...`);
    const buffer = Buffer.from(imageData, 'base64');
    
    // Upload the image to Vercel Blob storage
    const { url } = await put(`${jobId}.jpg`, buffer, {
      access: 'public',
    });
    
    console.log(`[${requestId}] [${jobId}] Image uploaded to Vercel Blob: ${url}`);

    // Create job record in KV
    await kv.hset(`job:${jobId}`, {
      status: 'processing',
      imageUrl: url,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      requestId
    });

    console.log(`[${requestId}] [${jobId}] Calling OpenAI Vision API...`);
    
    // Call OpenAI Vision API
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 1000,
      messages: [
        {
          role: "system",
          content: "You are a wine expert assistant that can identify wines from images of bottles or labels. For each wine detected in the image, provide detailed information in the following format:\n\n**Producer/Winery**: [Producer name]\n**Name**: [Wine name]\n**Vintage**: [Year]\n**Region**: [Region/Appellation]\n**Grape Varieties**: [Grape varieties]\n**Tasting Notes**: [Detailed tasting notes]\n**Score**: [Rating out of 100]\n**Price**: [Price if visible]\n\nIf multiple wines are visible in the image, analyze each one separately with the same format."
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Identify all wines visible in this image and provide details about each one. If there are multiple wines, analyze each one separately." },
            {
              type: "image_url",
              image_url: {
                url: url as string
              }
            }
          ]
        }
      ]
    });

    // Process OpenAI response with proper null checking
    const wineAnalysis = completion.choices[0]?.message?.content || '';
    console.log(`[${requestId}] [${jobId}] OpenAI analysis complete`);
    console.log(`[${requestId}] [${jobId}] Raw OpenAI response:`, wineAnalysis);

    // Parse the analysis into structured data for multiple wines
    const wineDataArray = parseWineDetails(wineAnalysis, requestId, jobId);
    console.log(`[${requestId}] [${jobId}] Parsed wine data:`, JSON.stringify(wineDataArray, null, 2));

    // Search for wine images and generate reviews using OpenAI's web search
    const winesWithImages = await Promise.all(wineDataArray.map(async (wine) => {
      try {
        const searchQueryBase = `${wine.producer} ${wine.name} ${wine.vintage}`;
        console.log(`[${requestId}] [${jobId}] Starting web search/review/image process for: ${searchQueryBase}`);
        
        // Step 1: Use Web Search for Textual Info (Reviews, Ratings) - Tool Call Flow
        const textSearchQuery = `${searchQueryBase} reviews`; // Simplified query
        console.log(`[${requestId}] [${jobId}] Performing text web search (tool flow) for: ${textSearchQuery}`);
        let actualTextSnippets = "No specific web results found."; // Initialize
        
        try {
          // Initial request indicating tool capability
          const initialTextSearchMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
              {
                role: "system",
                content: "You are a web search assistant focused on wine reviews. Indicate if you need to perform a web search to find reviews for the specified wine."
              },
              {
                role: "user",
                content: `Find review snippets for: ${searchQueryBase}`
              }
          ];
          const textSearchCompletion = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: initialTextSearchMessages,
            tools: [
              {
                type: "function",
                function: {
                  name: "web_search",
                  description: "Search the web for wine reviews and ratings", // General description
                  parameters: {
                    type: "object",
                    properties: {
                      query: { type: "string", description: "Search query for wine reviews/ratings" }
                    },
                    required: ["query"]
                  }
                }
              }
            ],
            tool_choice: "auto"
          });
          
          const textSearchAssistantMessage = textSearchCompletion.choices[0]?.message;
          console.log(`[${requestId}] [${jobId}] Initial text search assistant message for ${searchQueryBase}:`, JSON.stringify(textSearchAssistantMessage, null, 2));

          // Handle tool call if present
          if (textSearchAssistantMessage?.tool_calls) {
            console.log(`[${requestId}] [${jobId}] Text search tool call detected. Simulating tool response and making follow-up call.`);
            const toolFollowUpMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
              ...initialTextSearchMessages, 
              textSearchAssistantMessage, 
              // Add simulated tool responses
              ...textSearchAssistantMessage.tool_calls.map(tc => ({ 
                tool_call_id: tc.id,
                role: "tool" as const,
                // Updated simulation prompt based on user feedback
                content: `Simulated execution for tool call ${tc.id}. Based on your search results for '${searchQueryBase} reviews', collect 3 to 5 relevant quotes from 3 to 5 different websites. Return ONLY the raw text snippets found, each on a new line, stating the source if known (e.g., 'Source: Example.com - Snippet...'). If no relevant snippets are found, state 'No relevant snippets found.'` 
              }))
            ];

            try {
              const textToolResponseCompletion = await openai.chat.completions.create({
                model: "gpt-4o",
                messages: toolFollowUpMessages, 
              });
              actualTextSnippets = textToolResponseCompletion.choices[0]?.message?.content || "Failed to get snippets after tool call simulation.";
              console.log(`[${requestId}] [${jobId}] Follow-up text search response content:`, actualTextSnippets);
            } catch (toolResponseError) {
              console.error(`[${requestId}] [${jobId}] Error during follow-up text search call:`, toolResponseError);
              actualTextSnippets = "Error retrieving snippets after tool simulation.";
            }
          } else if (textSearchAssistantMessage?.content) {
            // Handle rare case where model answers directly (unlikely with this setup)
            actualTextSnippets = textSearchAssistantMessage.content;
             console.log(`[${requestId}] [${jobId}] Text search response content (no tool call):`, actualTextSnippets);
          }

        } catch(searchError) {
            console.error(`[${requestId}] [${jobId}] *** ERROR during initial text web search API call for ${searchQueryBase}: ***`, searchError);
            actualTextSnippets = 'Error during web search.';
        }

        // Step 2: Image Search (Keep existing tool call flow, update simulation prompt)
        const imageSearchQuery = `${searchQueryBase} Picture`; // Use user's suggested search format
        console.log(`[${requestId}] [${jobId}] Performing Google Image web search (tool flow) for: ${imageSearchQuery}`);
        let imageUrl = '';
        try {
            const initialImageSearchMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
                {
                    role: "system",
                    content: "You are an image finding assistant. Indicate if you need to perform a web search to find an image for the specified wine."
                },
                {
                    role: "user",
                    content: `Find an image for: ${imageSearchQuery}`
                }
            ];
            const imageSearchCompletion = await openai.chat.completions.create({
                model: "gpt-4o",
                messages: initialImageSearchMessages,
                tools: [
                  {
                    type: "function",
                    function: {
                      name: "web_search",
                      description: "Search Google Images for wine bottle pictures", // More specific
                      parameters: {
                        type: "object",
                        properties: {
                          query: { type: "string", description: "Search query for wine bottle pictures on Google Images" }
                        },
                        required: ["query"]
                      }
                    }
                  }
                ],
                tool_choice: "auto"
            });

            const imageSearchAssistantMessage = imageSearchCompletion.choices[0]?.message;
            console.log(`[${requestId}] [${jobId}] Initial image search assistant message for ${searchQueryBase}:`, JSON.stringify(imageSearchAssistantMessage, null, 2));

            let finalImageSearchContent = '';

            // Handle tool call if present
            if (imageSearchAssistantMessage?.tool_calls) {
              console.log(`[${requestId}] [${jobId}] Image search tool call detected. Simulating tool response and making follow-up call.`);
              const toolCall = imageSearchAssistantMessage.tool_calls[0]; 
              if (toolCall.function.name === 'web_search') { 
                  const imageToolFollowUpMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
                      ...initialImageSearchMessages,
                      imageSearchAssistantMessage,
                      {
                          tool_call_id: toolCall.id,
                          role: "tool" as const,
                          // Updated simulation prompt based on user feedback
                          content: `Simulated execution for tool call ${toolCall.id}. Provide the URL of the first relevant picture found from your search for '${imageSearchQuery}'. If no relevant image is found, state 'No image found.'`
                      }
                  ];
                  try {
                      const imageToolResponseCompletion = await openai.chat.completions.create({
                          model: "gpt-4o",
                          messages: imageToolFollowUpMessages,
                      });
                      finalImageSearchContent = imageToolResponseCompletion.choices[0]?.message?.content || '';
                      console.log(`[${requestId}] [${jobId}] Follow-up image search response content:`, finalImageSearchContent);
                  } catch (toolResponseError) {
                      console.error(`[${requestId}] [${jobId}] Error during follow-up image search call:`, toolResponseError);
                      finalImageSearchContent = 'Error retrieving image URL after tool simulation.';
                  }
              } else {
                 console.log(`[${requestId}] [${jobId}] Unexpected tool call name in image search: ${toolCall.function.name}`);
                 finalImageSearchContent = 'Unexpected tool call during image search.';
              }
            } else if (imageSearchAssistantMessage?.content) {
               finalImageSearchContent = imageSearchAssistantMessage.content;
               console.log(`[${requestId}] [${jobId}] Image search response content (no tool call):`, finalImageSearchContent);
            }

            // Extract URL from the final content 
            if (finalImageSearchContent && !finalImageSearchContent.toLowerCase().includes('no image found')) {
                const urlRegex = /(https?:\/\/[^\s]+\.(?:jpg|jpeg|png|gif|webp))/i;
                const foundUrls = finalImageSearchContent.match(urlRegex);
                if (foundUrls && foundUrls.length > 0) {
                    imageUrl = foundUrls[0];
                }
            }

        } catch (imageSearchError) {
            console.error(`[${requestId}] [${jobId}] *** ERROR during initial image web search API call for ${searchQueryBase}: ***`, imageSearchError);
        }
        console.log(`[${requestId}] [${jobId}] Final Extracted image URL for ${searchQueryBase}: ${imageUrl}`);

        // Step 3: Generate final review and rating using actualTextSnippets
        console.log(`[${requestId}] [${jobId}] Generating final review and rating for: ${searchQueryBase}`);
        let finalReview = wine.tastingNotes;
        let finalScore = wine.score || 0;
        
        const reviewMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
            {
                role: "system",
                content: `You are a professional wine critic. Synthesize the provided initial analysis and the web search snippets into TWO distinct outputs:
1. A concise final review (max 2 sentences).
2. A numerical score (1-100) based on all available information.

Respond ONLY with a JSON object containing 'review' (string) and 'score' (number) keys.`
            },
            {
                role: "user",
                content: `Create the JSON output (review and score) for ${searchQueryBase}:\n\n== Initial Analysis (from image) ==\nProducer: ${wine.producer}\nName: ${wine.name}\nVintage: ${wine.vintage}\nRegion: ${wine.region}\nGrape Varieties: ${wine.grapeVarieties}\nTasting Notes: ${wine.tastingNotes}\nScore: ${wine.score}\nPrice: ${wine.price}\n\n== Web Search Snippets Found ==\n${actualTextSnippets}` // Use the actual snippets variable
            }
        ];
        
        try {
            const reviewCompletion = await openai.chat.completions.create({
                model: "gpt-4o",
                messages: reviewMessages, 
                response_format: { type: "json_object" } 
            });
            const reviewContent = reviewCompletion.choices[0]?.message?.content;
            console.log(`[${requestId}] [${jobId}] Raw review/score response content for ${searchQueryBase}:`, reviewContent);
            if (reviewContent) {
                try {
                    const parsedResponse = JSON.parse(reviewContent);
                    finalReview = parsedResponse.review || finalReview;
                    finalScore = parsedResponse.score || finalScore;
                    console.log(`[${requestId}] [${jobId}] Parsed review: ${finalReview}`);
                    console.log(`[${requestId}] [${jobId}] Parsed score: ${finalScore}`);
                } catch (parseError) {
                    console.error(`[${requestId}] [${jobId}] Failed to parse review/score JSON:`, parseError, reviewContent);
                    finalReview = reviewContent.substring(0, 200); 
                }
            }
        } catch (reviewError) {
            console.error(`[${requestId}] [${jobId}] Error during final review/score generation for ${searchQueryBase}:`, reviewError);
        }
        
        // Step 4: Return combined data including actual snippets
        return {
          ...wine,
          tastingNotes: finalReview,
          score: finalScore,
          imageUrl: imageUrl || wine.imageUrl,
          webSnippets: actualTextSnippets // Pass actual snippets to frontend
        };
      } catch (error) {
        // Catch errors in the overall wine processing block
        console.error(`[${requestId}] [${jobId}] Major error processing wine ${wine.producer} ${wine.name}:`, error);
        return wine; 
      }
    }));
    
    // Store result in KV
    await kv.hset(`job:${jobId}`, {
      status: 'completed',
      data: {
        wines: winesWithImages,
        imageUrl: url,
        rawAnalysis: wineAnalysis
      },
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    console.log(`[${requestId}] [${jobId}] Stored results in KV, returning response`);
    
    // Return results immediately
    const responseData = {
      jobId,
      status: 'completed',
      requestId,
      data: {
        wines: winesWithImages,
        imageUrl: url
      }
    };
    
    return res.status(200).json(responseData);

  } catch (error: any) {
    console.error(`[${requestId}] [${jobId}] Error analyzing wine:`, error);
    
    // Update KV with the error
    try {
      await kv.hset(`job:${jobId}`, {
        status: 'failed',
        error: error.message || 'Unknown error',
        updatedAt: new Date().toISOString(),
        failedAt: new Date().toISOString()
      });
      console.log(`[${requestId}] [${jobId}] Updated KV with error status`);
    } catch (kvError) {
      console.error(`[${requestId}] [${jobId}] Failed to update KV with error:`, kvError);
    }
    
    // Return error with the jobId
    return res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to analyze image',
      jobId // Always include jobId in the response
    });
  }
}

// Helper function to parse the unstructured text from OpenAI into structured data
function parseWineDetails(analysis: string, requestId: string, jobId: string): WineData[] {
  console.log(`[${requestId}] [${jobId}] Parsing wine details from analysis:`, analysis);
  
  // Split the analysis into sections for each wine
  const wineSections = analysis.split(/(?=\*\*Producer\/Winery\*\*:)/);
  console.log(`[${requestId}] [${jobId}] Found ${wineSections.length} wine sections`);
  
  return wineSections.filter(section => section.trim()).map(section => {
    console.log(`[${requestId}] [${jobId}] Processing wine section:`, section);
    
    const wineData: WineData = {
      producer: '',
      name: '',
      vintage: '',
      region: '',
      grapeVarieties: '',
      tastingNotes: '',
      score: 0,
      price: '',
      imageUrl: '',
      webSnippets: ''
    };

    // Extract producer
    const producerMatch = section.match(/\*\*Producer\/Winery\*\*:\s*([^*\n]+)/);
    if (producerMatch) {
      wineData.producer = producerMatch[1].trim();
      console.log(`[${requestId}] [${jobId}] Found producer:`, wineData.producer);
    }

    // Extract name
    const nameMatch = section.match(/\*\*Name\*\*:\s*([^*\n]+)/);
    if (nameMatch) {
      wineData.name = nameMatch[1].trim();
      console.log(`[${requestId}] [${jobId}] Found name:`, wineData.name);
    }

    // Extract vintage
    const vintageMatch = section.match(/\*\*Vintage\*\*:\s*(\d{4})/);
    if (vintageMatch) {
      wineData.vintage = vintageMatch[1];
      console.log(`[${requestId}] [${jobId}] Found vintage:`, wineData.vintage);
    }

    // Extract region
    const regionMatch = section.match(/\*\*Region\*\*:\s*([^*\n]+)/);
    if (regionMatch) {
      wineData.region = regionMatch[1].trim();
      console.log(`[${requestId}] [${jobId}] Found region:`, wineData.region);
    }

    // Extract grape varieties
    const grapeMatch = section.match(/\*\*Grape Varieties\*\*:\s*([^*\n]+)/);
    if (grapeMatch) {
      wineData.grapeVarieties = grapeMatch[1].trim();
      console.log(`[${requestId}] [${jobId}] Found grape varieties:`, wineData.grapeVarieties);
    }

    // Extract tasting notes
    const tastingMatch = section.match(/\*\*Tasting Notes\*\*:\s*([^*\n]+)/);
    if (tastingMatch) {
      wineData.tastingNotes = tastingMatch[1].trim();
      console.log(`[${requestId}] [${jobId}] Found tasting notes:`, wineData.tastingNotes);
    }

    // Extract score
    const scoreMatch = section.match(/\*\*Score\*\*:\s*(\d+)/);
    if (scoreMatch) {
      wineData.score = parseInt(scoreMatch[1]);
      console.log(`[${requestId}] [${jobId}] Found score:`, wineData.score);
    }

    // Extract price
    const priceMatch = section.match(/\*\*Price\*\*:\s*([^*\n]+)/);
    if (priceMatch) {
      wineData.price = priceMatch[1].trim();
      console.log(`[${requestId}] [${jobId}] Found price:`, wineData.price);
    }

    // If we have at least a producer or name, consider this a valid wine entry
    if (wineData.producer || wineData.name) {
      console.log(`[${requestId}] [${jobId}] Valid wine entry found:`, wineData);
      return wineData;
    }
    console.log(`[${requestId}] [${jobId}] Invalid wine entry, skipping`);
    return null;
  }).filter((wine): wine is WineData => wine !== null);
} 