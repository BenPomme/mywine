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
  varietal: string;
  type: string;
  score: number;
  summary: string;
  imageUrl: string;
  ratingSource: string;
  additionalReviews: Array<{source: string, review: string}>;
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
          content: "You are a wine expert assistant that can identify wines from images of bottles or labels. For each wine detected in the image, provide detailed information including the producer/winery, name, vintage year, region, grape varieties, and any other relevant details visible in the image. If possible, estimate the wine's quality and provide tasting notes based on your knowledge of the wine. If multiple wines are visible in the image, analyze each one separately."
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
    const wineDataArray = parseWineDetails(wineAnalysis);
    console.log(`[${requestId}] [${jobId}] Parsed wine data:`, JSON.stringify(wineDataArray, null, 2));

    // Search for wine images using OpenAI's web search tool
    const winesWithImages = await Promise.all(wineDataArray.map(async (wine) => {
      try {
        const searchQuery = `${wine.producer} ${wine.name} ${wine.vintage} wine bottle`;
        const searchCompletion = await openai.chat.completions.create({
          model: process.env.OPENAI_MODEL || "gpt-4o",
          messages: [
            {
              role: "system",
              content: "You are a wine expert assistant. Search for an image of the specified wine bottle and return the first image URL from the search results."
            },
            {
              role: "user",
              content: `Search for an image of this wine: ${searchQuery}`
            }
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "web_search",
                description: "Search the web for information about a wine",
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
            }
          ],
          tool_choice: "auto"
        });

        const toolCall = searchCompletion.choices[0]?.message?.tool_calls?.[0];
        if (toolCall?.function?.name === "web_search") {
          const searchResult = JSON.parse(toolCall.function.arguments);
          const searchResponse = await fetch(`https://api.openai.com/v1/web/search`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
            },
            body: JSON.stringify({
              query: searchResult.query,
              type: 'image'
            })
          });

          const searchData = await searchResponse.json();
          if (searchData.images?.[0]?.url) {
            return {
              ...wine,
              imageUrl: searchData.images[0].url
            };
          }
        }
      } catch (error) {
        console.error(`Error searching for wine image:`, error);
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
function parseWineDetails(analysisText: string): WineData[] {
  // Split the analysis text into sections for each wine
  const wineSections = analysisText.split(/(?=\d+\.|Wine \d+:|Bottle \d+:|First|Second|Third|Fourth|Fifth)/i);
  
  return wineSections.map(section => {
    // Create a default structure for each wine
    const wineData: WineData = {
      name: '',
      producer: '',
      vintage: '',
      region: '',
      varietal: '',
      type: '',
      score: 0,
      summary: section.trim(),
      imageUrl: '',
      ratingSource: 'AI Analysis',
      additionalReviews: []
    };

    // Extract producer/winery
    const producerMatch = section.match(/(?:Producer|Winery|Maker):\s*([^,\n.]+)/i);
    if (producerMatch) wineData.producer = producerMatch[1].trim();

    // Extract name
    const nameMatch = section.match(/(?:Name|Wine):\s*([^,\n.]+)/i);
    if (nameMatch) wineData.name = nameMatch[1].trim();
    
    // Extract vintage
    const vintageMatch = section.match(/(?:Vintage|Year):\s*(\d{4})/i);
    if (vintageMatch) wineData.vintage = vintageMatch[1];

    // Extract region
    const regionMatch = section.match(/(?:Region|Appellation):\s*([^,\n.]+)/i);
    if (regionMatch) wineData.region = regionMatch[1].trim();
    
    // Extract grape variety
    const varietalMatch = section.match(/(?:Grape|Varietal|Variety):\s*([^,\n.]+)/i);
    if (varietalMatch) wineData.varietal = varietalMatch[1].trim();
    
    // Extract wine type
    const typeMatch = section.match(/(?:Type):\s*(red|white|rosé|rose|sparkling|dessert)/i);
    if (typeMatch) wineData.type = typeMatch[1].trim();
    
    // Extract score if available
    const scoreMatch = section.match(/(?:Rating|Score|Points):\s*(\d{1,2}(?:\.\d)?)\s*(?:\/\s*\d{1,3}|points)?/i);
    if (scoreMatch) {
      const scoreValue = parseFloat(scoreMatch[1]);
      // Normalize to a 100-point scale if needed
      if (scoreValue <= 5) {
        wineData.score = scoreValue * 20; // Convert 5-point scale to 100
      } else if (scoreValue <= 10) {
        wineData.score = scoreValue * 10; // Convert 10-point scale to 100
      } else if (scoreValue <= 20) {
        wineData.score = scoreValue * 5; // Convert 20-point scale to 100
      } else {
        wineData.score = scoreValue; // Already on 100-point scale
      }
    } else {
      // Estimate a score based on sentiment in the text
      const positiveTerms = ['excellent', 'outstanding', 'superb', 'exceptional', 'great', 'remarkable', 'fantastic'];
      const mediumTerms = ['good', 'nice', 'pleasant', 'enjoyable', 'decent', 'fine'];
      const negativeTerms = ['poor', 'disappointing', 'mediocre', 'bad', 'flawed'];
      
      let scoreEstimate = 85; // Default medium-high score
      
      for (const term of positiveTerms) {
        if (section.toLowerCase().includes(term)) {
          scoreEstimate += 5;
          break;
        }
      }
      
      for (const term of mediumTerms) {
        if (section.toLowerCase().includes(term)) {
          scoreEstimate = 80;
          break;
        }
      }
      
      for (const term of negativeTerms) {
        if (section.toLowerCase().includes(term)) {
          scoreEstimate = 70;
          break;
        }
      }
      
      wineData.score = Math.min(100, scoreEstimate); // Cap at 100
    }

    // Extract tasting notes as reviews
    const tastingMatch = section.match(/(?:Tasting Notes|Taste|Palate|Notes|Flavors):\s*([^.]+)/i);
    if (tastingMatch) {
      wineData.additionalReviews = [{
        source: 'AI Analysis',
        review: tastingMatch[1].trim()
      }];
    }

    return wineData;
  }).filter(wine => wine.name || wine.producer); // Only return wines that have at least a name or producer
} 