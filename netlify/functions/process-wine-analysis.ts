import type { Handler, HandlerEvent, HandlerContext } from "@netlify/functions";
import axios from 'axios';
import { OpenAI } from 'openai';
import { kv } from '@vercel/kv'; // Use Vercel KV from the Netlify function
import { v4 as uuidv4 } from 'uuid';

// Define types (consider moving to a shared types file later)
interface WineInfoInput {
    name?: string;
    vintage?: string;
    producer?: string;
    region?: string;
    varietal?: string;
}

interface WineRating {
    score: number;
    source: string;
    review?: string;
}

interface Review {
    source: string;
    rating?: number | null;
    review: string;
}

interface ProcessedWine {
    name: string;
    vintage?: string;
    producer?: string;
    region?: string;
    varietal?: string;
    imageUrl?: string | null;
    score: number;
    ratingSource: string;
    summary?: string;
    additionalReviews?: Review[];
    error?: string; // Add error field for partial failures
}


// --- Environment Variable Check ---
// Fetch keys within the handler or ensure they are loaded
let openai: OpenAI;
const serperApiKey = process.env.SERPER_API_KEY;
const openAIApiKey = process.env.OPENAI_API_KEY;

function initializeOpenAI() {
    if (!openai && openAIApiKey) {
        openai = new OpenAI({ apiKey: openAIApiKey });
    } else if (!openAIApiKey) {
         console.error("OPENAI_API_KEY environment variable is not set.");
         // Throwing error might be better to stop execution if critical
    }
}

// --- Helper Functions (Adapted from original API route) ---

// Analyze image using URL
async function analyzeImageWithOpenAI(imageUrl: string): Promise<WineInfoInput[]> {
    initializeOpenAI(); // Ensure OpenAI client is initialized
    if (!openai) throw new Error("OpenAI client not initialized due to missing API key.");

    try {
        console.log("Calling OpenAI Vision API with URL:", imageUrl);
        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                {
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text: "Analyze this image and identify ALL wine bottles visible. For each wine, extract: name, vintage, producer, region, and varietal. Return a JSON array where each object represents a wine with these fields. If there are multiple wines, list all of them. Format: [{wine1}, {wine2}, ...]. Do not include markdown formatting or backticks."
                        },
                        {
                            type: "image_url",
                            image_url: {
                                url: imageUrl // Use the image URL directly
                            }
                        }
                    ]
                }
            ],
            max_tokens: 500
        });

        let content = response.choices[0].message.content || '[]';
        console.log("Raw OpenAI Vision API response:", content);

        // --- Robust JSON Parsing Logic ---
        // Remove markdown code blocks if present
        if (content.includes("```")) {
            content = content.replace(/```json\s*|\s*```/g, '');
        }
        content = content.trim();

        let parsedWines: any[] = [];
        try {
            if (content.startsWith('[')) {
                parsedWines = JSON.parse(content);
            } else if (content.startsWith('{')) {
                // Handle case where a single object is returned without brackets
                 parsedWines = [JSON.parse(content)];
            } else {
                 console.warn("OpenAI response is not valid JSON:", content);
                 // Maybe try regex extraction as a last resort if needed, but prefer structured output
                 return []; // Return empty if not valid JSON array/object
            }
        } catch (parseError) {
            console.error("Error parsing JSON from OpenAI:", parseError);
            // Fallback might be complex here, maybe just return empty
             return [];
        }

        console.log(`Identified ${parsedWines.length} potential wine(s)`);

        // Normalize data structure
        return parsedWines.map((wine: any) => ({
            name: wine.name || wine.wine_name || '',
            vintage: wine.vintage || wine.year || '',
            producer: wine.producer || wine.winery || '',
            region: wine.region || '',
            varietal: wine.varietal || wine.grape_variety || ''
        })).filter(wine => wine.name); // Ensure at least a name was found
    } catch (error) {
        console.error("Error calling OpenAI Vision API:", error);
        // Propagate error or return empty? Let's return empty for now.
        return [];
    }
}

async function getWineReviews(wineName: string, winery: string, year: string): Promise<string[]> {
    if (!wineName || !serperApiKey) return [];
    const siteQuery = `site:winespectator.com OR site:vivino.com OR site:decanter.com`;
    const searchQuery = `${year || ''} ${winery || ''} ${wineName} reviews OR tasting notes OR opinions ${siteQuery}`.trim().replace(/\s+/g, ' ');
    console.log("Executing targeted Serper search:", searchQuery);
    try {
        const response = await axios.post('https://google.serper.dev/search',
            { q: searchQuery, gl: 'us', num: 5 }, // Keep num=5 for now
            { headers: { 'X-API-KEY': serperApiKey, 'Content-Type': 'application/json' } }
        );
        if (response.data.organic && response.data.organic.length > 0) {
            return response.data.organic.map((item: any) => item.snippet || '').filter(Boolean);
        }
        return [];
    } catch (error) {
        console.error('Error fetching wine reviews from Serper:', error instanceof Error ? error.message : error);
        return [];
    }
}

async function extractRatingFromReviews(reviews: string[]): Promise<WineRating> {
    if (!reviews || reviews.length === 0) {
        return { score: 0, source: 'No reviews provided' };
    }
    const ratingPatterns = [ /(\d{1,3})\s*\/\s*100/i, /(\d{1,2})\s*\/\s*5/i, /(\d{1,3})\s*pts/i, /(\d{1,3})\s*points/i, /(\d{1,3})\s*%/i, /(\d{1,2})\s*stars/i, /rated\s*(\d{1,3})/i ];
    let highestScore = 0;
    let ratingSource = '';
    let bestReview = '';

    reviews.forEach(review => {
        if (!review) return;
        let reviewText = typeof review === 'string' ? review : (review as any).snippet || (review as any).text || '';
        let reviewSrc = typeof review === 'string' ? 'Review Snippet' : (review as any).source || 'Review Snippet'; // Source info not available here anymore directly

        for (const pattern of ratingPatterns) {
            const match = reviewText.match(pattern);
            if (match) {
                let score = parseInt(match[1]);
                if (pattern.toString().includes('/5') || pattern.toString().includes('stars')) { score = Math.round((score / 5) * 100); }
                score = Math.min(score, 100);
                if (score > highestScore) { highestScore = score; ratingSource = reviewSrc; bestReview = reviewText; }
                break;
            }
        }
    });

    if (highestScore === 0) {
        return { score: 0, source: 'No rating found via regex', review: reviews.join('\n').substring(0, 100) + '...' };
    }
    return { score: highestScore, source: ratingSource, review: bestReview };
}

async function estimateScoreFromReviews(reviews: string[]): Promise<WineRating> {
     initializeOpenAI();
     if (!openai) return { score: 75, source: 'AI Estimated (OpenAI Init Failed)', review: 'OpenAI client not initialized.' };
    if (!reviews || reviews.length === 0) { return { score: 75, source: 'AI Estimated (Default)', review: 'No reviews available for analysis' }; }

    const combinedReviews = reviews.join('\\n\\n').substring(0, 1500);
    const prompt = `Analyze these wine reviews and estimate a score from 0-100 based on the sentiment and wine descriptors:\n\n${combinedReviews}\n\nRespond with a JSON object in this format:\n{\n"score": A number from 0-100,\n"explanation": "A brief explanation"\n}`;

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o", // Or gpt-3.5-turbo for speed/cost
            messages: [{ role: "user", content: prompt }],
            max_tokens: 150, temperature: 0.2,
            response_format: { type: "json_object" }, // Request JSON output
        });
        const content = response.choices[0]?.message?.content || '{}';
        const result = JSON.parse(content);
        return { score: result.score || 75, source: 'AI Estimated', review: result.explanation || combinedReviews.substring(0, 100) + '...' };
    } catch (error) {
        console.error('Error estimating score from reviews:', error);
        return { score: 75, source: 'AI Estimated (Fallback)', review: combinedReviews.substring(0, 100) + '...' };
    }
}


async function generateAISummary(reviews: string[]): Promise<string> {
    initializeOpenAI();
    if (!openai) return 'AI Summary generation failed (OpenAI Init Failed).';
    if (!reviews || reviews.length === 0) return '';

    const prompt = `Analyze these wine review snippets and provide a single, elegant sentence summarizing the overall sentiment and key characteristics. Be honest and balanced, reflecting both positive and negative points if present:\n\n${reviews.join('\\n---\\n')}\n\nRespond with only the summary sentence.`;

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o", // Or gpt-3.5-turbo
            messages: [
                { role: "system", content: "You are a sophisticated wine connoisseur who summarizes reviews concisely and elegantly, capturing the essence honestly." },
                { role: "user", content: prompt }
            ],
            temperature: 0.6, max_tokens: 100
        });
        return response.choices[0].message.content?.trim() || '';
    } catch (error) {
        console.error('Error generating AI Summary:', error);
        return 'Failed to generate AI summary.';
    }
}

async function fetchWineImage(wineName: string): Promise<string | null> {
    if (!wineName || !serperApiKey) return null;
    try {
        const response = await axios.get('https://google.serper.dev/images', {
            headers: { 'X-API-KEY': serperApiKey, 'Content-Type': 'application/json' },
            params: { q: `${wineName} wine bottle`, gl: 'us' }
        });
        if (response.data.images && response.data.images.length > 0) {
            const image = response.data.images.find((img: any) => img.imageUrl && !img.imageUrl.includes('thumb'));
            return image ? image.imageUrl : response.data.images[0].imageUrl;
        }
        return null;
    } catch (error) {
        console.error('Error fetching wine image from Serper:', error);
        return null;
    }
}

// --- 1. Initial Setup ---
async function initializeKV() {
    if (!process.env.KV_URL || !process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
        throw new Error('Missing required KV environment variables');
    }
    console.log('Initializing KV connection...');
    try {
        await kv.ping();
        console.log('KV connection successful');
    } catch (error) {
        console.error('KV connection failed:', error);
        throw error;
    }
}

// --- 2. Main Handler ---
export const handler = async (event: any) => {
    const requestId = event.body?.requestId || uuidv4();
    const jobId = event.body?.jobId;
    const imageUrl = event.body?.imageUrl;

    console.log(`[${requestId}] [${jobId}] Netlify function started`);
    console.log(`[${requestId}] [${jobId}] Event body:`, JSON.stringify(event.body, null, 2));

    if (!jobId || !imageUrl) {
        console.error(`[${requestId}] [${jobId}] Missing required parameters:`, { 
            jobId, 
            imageUrl,
            body: event.body 
        });
        return {
            statusCode: 400,
            body: JSON.stringify({ 
                error: 'Missing required parameters',
                received: {
                    jobId,
                    imageUrl,
                    requestId
                }
            })
        };
    }

    try {
        // Initialize KV connection
        await initializeKV();
        console.log(`[${requestId}] [${jobId}] KV initialized successfully`);

        // --- 3. Process Image ---
        console.log(`[${requestId}] [${jobId}] Starting image analysis...`);
        const startTime = Date.now();
        
        // Analyze image using OpenAI
        const wines = await analyzeImageWithOpenAI(imageUrl);
        console.log(`[${requestId}] [${jobId}] OpenAI analysis complete, found ${wines.length} wines`);

        // --- 4. Process Each Wine ---
        const processedWines = await Promise.all(wines.map(async (wine) => {
            console.log(`[${requestId}] [${jobId}] Processing wine:`, wine.name);
            
            // Get wine image
            const wineImageUrl = await fetchWineImage(wine.name || '');
            console.log(`[${requestId}] [${jobId}] Wine image URL:`, wineImageUrl);

            // Get wine reviews
            const reviews = await getWineReviews(wine.name || '', wine.producer || '', wine.vintage || '');
            console.log(`[${requestId}] [${jobId}] Found ${reviews.length} reviews`);

            // Extract rating
            const rating = await extractRatingFromReviews(reviews);
            console.log(`[${requestId}] [${jobId}] Extracted rating:`, rating);

            // Estimate score
            const score = await estimateScoreFromReviews(reviews);
            console.log(`[${requestId}] [${jobId}] Estimated score:`, score);

            // Generate summary
            const summary = await generateAISummary(reviews);
            console.log(`[${requestId}] [${jobId}] Generated summary`);

            return {
                ...wine,
                imageUrl: wineImageUrl,
                score,
                ratingSource: rating.source,
                summary,
                additionalReviews: reviews.slice(0, 2).map(review => ({
                    source: 'Review Snippet',
                    review
                }))
            };
        }));

        // --- 5. Store Results ---
        const result = {
            status: 'completed',
            wines: processedWines,
            imageUrl,
            completionTimestamp: Date.now(),
            durationMs: Date.now() - startTime
        };

        console.log(`[${requestId}] [${jobId}] Storing results in KV...`);
        try {
            await kv.set(jobId, result, { ex: 3600 });
            console.log(`[${requestId}] [${jobId}] Successfully stored final result in KV`);
            
            // Verify the data was stored correctly
            const storedData = await kv.get(jobId);
            console.log(`[${requestId}] [${jobId}] Verified KV data after storage:`, JSON.stringify(storedData, null, 2));
        } catch (kvError) {
            console.error(`[${requestId}] [${jobId}] Error storing results in KV:`, kvError);
            throw kvError;
        }

        console.log(`[${requestId}] [${jobId}] Analysis complete. Results stored in KV.`);
        return {
            statusCode: 200,
            body: JSON.stringify({ success: true, jobId })
        };

    } catch (error: any) {
        console.error(`[${requestId}] [${jobId}] Error in Netlify function:`, error);
        
        // Update KV with error status
        try {
            await kv.set(jobId, {
                status: 'failed',
                error: error.message || 'Unknown error during processing',
                imageUrl,
                errorTimestamp: Date.now()
            }, { ex: 3600 });
            console.log(`[${requestId}] [${jobId}] Updated KV with error status`);
        } catch (kvError) {
            console.error(`[${requestId}] [${jobId}] Error updating KV with error status:`, kvError);
        }

        return {
            statusCode: 500,
            body: JSON.stringify({ 
                error: 'Failed to process wine analysis',
                details: error.message,
                jobId
            })
        };
    }
};