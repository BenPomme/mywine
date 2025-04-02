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
      model: process.env.OPENAI_MODEL || "gpt-4o",
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
    console.log(`[${requestId}] [${jobId}] OpenAI response received: "${wineAnalysis.substring(0, 100)}..."`);

    // Parse the analysis into structured data for multiple wines
    const wineDataArray = parseWineDetails(wineAnalysis, requestId, jobId);
    console.log(`[${requestId}] [${jobId}] Parsed wine data:`, JSON.stringify(wineDataArray, null, 2));

    // Search for wine images using OpenAI's web search tool
    const winesWithImages = await Promise.all(wineDataArray.map(async (wine) => {
      try {
        const searchQuery = `${wine.producer} ${wine.name} ${wine.vintage} wine bottle`;
        console.log(`[${requestId}] [${jobId}] Searching for wine image with query: ${searchQuery}`);
        
        // First call: Use web search to get info about the wine
        const searchCompletion = await openai.chat.completions.create({
          model: process.env.OPENAI_MODEL || "gpt-4o",
          messages: [
            {
              role: "user",
              content: `I need information about this wine: ${searchQuery}`
            }
          ],
          tools: [{
            type: "function",
            function: {
              name: "web_search",
              description: "Search the web for information",
              parameters: {
                type: "object",
                properties: {
                  query: {
                    type: "string",
                    description: "The search query"
                  }
                },
                required: ["query"]
              }
            }
          }],
          tool_choice: {
            type: "function",
            function: {
              name: "web_search"
            }
          }
        });

        // Extract the web search results from the message
        const webSearchMessage = searchCompletion.choices[0]?.message;
        console.log(`[${requestId}] [${jobId}] Web search results received`);
        
        // Extract tool call results if present
        let webSearchContent = '';
        if (webSearchMessage?.tool_calls) {
          // Handle the tool call response
          const toolCall = webSearchMessage.tool_calls[0];
          if (toolCall?.function?.name === 'web_search') {
            try {
              const args = JSON.parse(toolCall.function.arguments);
              if (args.query) {
                // Get web search results with a second API call
                const webSearchResponse = await fetch('https://api.openai.com/v1/assistants/api/web-search', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
                  },
                  body: JSON.stringify({ query: args.query })
                });
                
                if (webSearchResponse.ok) {
                  const searchData = await webSearchResponse.json();
                  webSearchContent = searchData.text || '';
                  console.log(`[${requestId}] [${jobId}] Web search content: ${webSearchContent.substring(0, 100)}...`);
                }
              }
            } catch (error) {
              console.error(`[${requestId}] [${jobId}] Error processing web search:`, error);
            }
          }
        }

        // Second call: Generate complete review based on search results
        const reviewCompletion = await openai.chat.completions.create({
          model: process.env.OPENAI_MODEL || "gpt-4o",
          messages: [
            {
              role: "system",
              content: "You are a sommelier and wine expert. Create a detailed review of this wine based on the information provided and search results. Include flavor profile, food pairings, and why this wine is special."
            },
            // Include the initial wine data
            {
              role: "user", 
              content: `Create a detailed review for this wine:\n- Producer: ${wine.producer}\n- Name: ${wine.name}\n- Vintage: ${wine.vintage}\n- Region: ${wine.region}\n- Grape Varieties: ${wine.grapeVarieties}\n\nHere's what I found about this wine online: ${webSearchContent}`
            }
          ]
        });
        
        // Extract the review content
        const wineReview = reviewCompletion.choices[0]?.message?.content || '';
        console.log(`[${requestId}] [${jobId}] Generated wine review for ${wine.name}`);
        
        // Third call: Use web search to get an image of the wine
        const imageSearchCompletion = await openai.chat.completions.create({
          model: process.env.OPENAI_MODEL || "gpt-4o",
          messages: [
            {
              role: "user",
              content: `Find an image of this wine bottle: ${searchQuery}`
            }
          ],
          tools: [{
            type: "function",
            function: {
              name: "web_search",
              description: "Search the web for images",
              parameters: {
                type: "object",
                properties: {
                  query: {
                    type: "string",
                    description: "The search query"
                  }
                },
                required: ["query"]
              }
            }
          }],
          tool_choice: {
            type: "function",
            function: {
              name: "web_search"
            }
          }
        });
        
        // Extract image URL from the message content
        const imageSearchMessage = imageSearchCompletion.choices[0]?.message;
        let imageUrl = '';
        
        // Process tool calls for image search
        if (imageSearchMessage?.tool_calls) {
          const toolCall = imageSearchMessage.tool_calls[0];
          if (toolCall?.function?.name === 'web_search') {
            try {
              const args = JSON.parse(toolCall.function.arguments);
              if (args.query) {
                // Get image search results with a second API call
                const imageSearchResponse = await fetch('https://api.openai.com/v1/assistants/api/web-search', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
                  },
                  body: JSON.stringify({ 
                    query: args.query,
                    type: 'image'
                  })
                });
                
                if (imageSearchResponse.ok) {
                  const searchData = await imageSearchResponse.json();
                  if (searchData.images && searchData.images.length > 0) {
                    imageUrl = searchData.images[0].url || '';
                    console.log(`[${requestId}] [${jobId}] Found image URL: ${imageUrl}`);
                  }
                }
              }
            } catch (error) {
              console.error(`[${requestId}] [${jobId}] Error processing image search:`, error);
            }
          }
        }
        
        if (!imageUrl) {
          // Fallback if no image found through tool call
          const imageSearchContent = imageSearchMessage?.content || '';
          console.log(`[${requestId}] [${jobId}] Image search content: ${imageSearchContent.substring(0, 100)}...`);
          
          // Parse the message content to find image URLs
          const urlRegex = /(https?:\/\/[^\s]+\.(?:jpg|jpeg|png|gif|webp))/gi;
          const imageUrls = imageSearchContent.match(urlRegex);
          imageUrl = imageUrls ? imageUrls[0] : '';
          
          console.log(`[${requestId}] [${jobId}] Found image URL (fallback): ${imageUrl}`);
        }
        
        return {
          ...wine,
          tastingNotes: wineReview,
          imageUrl: imageUrl
        };
      } catch (error) {
        console.error(`[${requestId}] [${jobId}] Error searching for wine image:`, error);
      }
      return wine;
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
  
  return wineSections.map(section => {
    const wineData: WineData = {
      producer: '',
      name: '',
      vintage: '',
      region: '',
      grapeVarieties: '',
      tastingNotes: '',
      score: 0,
      price: '',
      imageUrl: ''
    };

    // Extract producer
    const producerMatch = section.match(/\*\*Producer\/Winery\*\*:\s*([^*\n]+)/);
    if (producerMatch) {
      wineData.producer = producerMatch[1].trim();
    }

    // Extract name
    const nameMatch = section.match(/\*\*Name\*\*:\s*([^*\n]+)/);
    if (nameMatch) {
      wineData.name = nameMatch[1].trim();
    }

    // Extract vintage
    const vintageMatch = section.match(/\*\*Vintage\*\*:\s*(\d{4})/);
    if (vintageMatch) {
      wineData.vintage = vintageMatch[1];
    }

    // Extract region
    const regionMatch = section.match(/\*\*Region\*\*:\s*([^*\n]+)/);
    if (regionMatch) {
      wineData.region = regionMatch[1].trim();
    }

    // Extract grape varieties
    const grapeMatch = section.match(/\*\*Grape Varieties\*\*:\s*([^*\n]+)/);
    if (grapeMatch) {
      wineData.grapeVarieties = grapeMatch[1].trim();
    }

    // Extract tasting notes
    const tastingMatch = section.match(/\*\*Tasting Notes\*\*:\s*([^*\n]+)/);
    if (tastingMatch) {
      wineData.tastingNotes = tastingMatch[1].trim();
    }

    // Extract score
    const scoreMatch = section.match(/\*\*Score\*\*:\s*(\d+)/);
    if (scoreMatch) {
      wineData.score = parseInt(scoreMatch[1]);
    }

    // Extract price
    const priceMatch = section.match(/\*\*Price\*\*:\s*([^*\n]+)/);
    if (priceMatch) {
      wineData.price = priceMatch[1].trim();
    }

    // If we have at least a producer or name, consider this a valid wine entry
    if (wineData.producer || wineData.name) {
      console.log(`[${requestId}] [${jobId}] Parsed wine data:`, wineData);
      return wineData;
    }
    return null;
  }).filter((wine): wine is WineData => wine !== null);
} 