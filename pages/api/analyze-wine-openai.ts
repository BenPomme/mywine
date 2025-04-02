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
      model: "gpt-4-vision-preview",
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
        const searchQuery = `${wine.producer} ${wine.name} ${wine.vintage}`;
        console.log(`[${requestId}] [${jobId}] Starting web search and review generation for: ${searchQuery}`);
        
        // Step 1: Use GPT-4 with web search to find reviews, ratings, and image URL
        console.log(`[${requestId}] [${jobId}] Performing web search for: ${searchQuery}`);
        const searchCompletion = await openai.chat.completions.create({
          model: "gpt-4-turbo-preview", // Or a model that supports web search well
          messages: [
            {
              role: "system",
              content: "You are a helpful assistant. Search the web for information about the specified wine. Provide a summary of professional reviews, ratings, and tasting notes found online. Critically, also find and include a direct URL to an image of the wine bottle in your response text."
            },
            {
              role: "user",
              content: `Search for detailed information and an image URL for this wine: ${searchQuery} (Producer: ${wine.producer}, Name: ${wine.name}, Vintage: ${wine.vintage})`
            }
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "web_search",
                description: "Search the web for wine information, reviews, ratings, and images",
                parameters: {
                  type: "object",
                  properties: {
                    query: {
                      type: "string",
                      description: "Optimized search query for wine information, reviews, ratings, and images"
                    }
                  },
                  required: ["query"]
                }
              }
            }
          ],
          tool_choice: "auto" // Let the model decide when to use the tool
        });

        const searchMessage = searchCompletion.choices[0]?.message;
        const webSearchResultsContent = searchMessage?.content || '';
        console.log(`[${requestId}] [${jobId}] Web search response content for ${searchQuery}:`, webSearchResultsContent);

        // Step 2: Extract image URL from the response content
        const urlRegex = /(https?:\/\/[^\s]+\.(?:jpg|jpeg|png|gif|webp))/gi;
        const imageUrls = webSearchResultsContent.match(urlRegex);
        const imageUrl = imageUrls ? imageUrls[0] : '';
        console.log(`[${requestId}] [${jobId}] Extracted image URL for ${searchQuery}: ${imageUrl}`);

        // Step 3: Generate a final, comprehensive review using initial analysis + web results
        console.log(`[${requestId}] [${jobId}] Generating final review for: ${searchQuery}`);
        const reviewCompletion = await openai.chat.completions.create({
          model: "gpt-4-turbo-preview", // Use a strong model for synthesis
          messages: [
            {
              role: "system",
              content: "You are a professional wine critic. Synthesize the provided initial analysis and the web search findings into a single, comprehensive, and engaging review. Include tasting notes, food pairings, rating/score, and overall impression. If the web search didn't provide much, rely more on the initial analysis."
            },
            {
              role: "user",
              content: `Create a final review combining these details for ${wine.producer} ${wine.name} ${wine.vintage}:\n\n== Initial Analysis (from image) ==\nProducer: ${wine.producer}\nName: ${wine.name}\nVintage: ${wine.vintage}\nRegion: ${wine.region}\nGrape Varieties: ${wine.grapeVarieties}\nTasting Notes: ${wine.tastingNotes}\nScore: ${wine.score}\nPrice: ${wine.price}\n\n== Web Search Findings ==\n${webSearchResultsContent}`
            }
          ]
        });

        const finalReview = reviewCompletion.choices[0]?.message?.content || wine.tastingNotes;
        console.log(`[${requestId}] [${jobId}] Generated final review for ${searchQuery}:`, finalReview);
        
        // Step 4: Return the combined data
        return {
          ...wine,
          tastingNotes: finalReview, // Update with the synthesized review
          imageUrl: imageUrl || wine.imageUrl // Use found image URL, fallback to original if any
        };
      } catch (error) {
        console.error(`[${requestId}] [${jobId}] Error processing web search/review for ${wine.name}:`, error);
        // Return the original wine data if this step fails
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
      imageUrl: ''
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