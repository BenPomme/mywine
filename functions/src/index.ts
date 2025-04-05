import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { v4 as uuidv4 } from 'uuid';
import OpenAI from 'openai';

// Initialize Firebase Admin
try {
  admin.initializeApp();
} catch (error) {
  // If already initialized, use that app
  console.log('Firebase admin already initialized or error:', error);
}

// Initialize Firestore and Storage only if needed in a try-catch to handle API not enabled errors
let db: FirebaseFirestore.Firestore | null = null;
let storage: admin.storage.Storage | null = null;
let bucket: any = null; // Use any type for the bucket

try {
  db = admin.firestore();
  storage = admin.storage();
  bucket = storage.bucket();
} catch (error) {
  console.error('Error initializing Firestore or Storage:', error);
}

// Load OpenAI API key from environment variable
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || ""
});

// We'll use OpenAI for web snippets instead of a separate search API

// Define interface types
interface WineInfoInput {
  name?: string;
  vintage?: string;
  producer?: string;
  region?: string;
  varietal?: string;
  imageUrl?: string;
}

// Analyze image with OpenAI
async function analyzeImageWithOpenAI(imageUrl: string): Promise<WineInfoInput[]> {
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
              text: `Analyze this image and identify ALL wines visible, whether they're bottles, labels, or entries on a wine menu/list.

For each wine, extract these details (if available):
- name: The specific name of the wine
- vintage: The year the wine was produced
- producer: The winery or producer
- region: The region or country of origin
- varietal: The grape variety/varieties

IMPORTANT: 
- If analyzing a wine menu, capture ALL separate wine entries
- Sort wines by likely quality (best wines first) if multiple are found
- List ALL wines visible, up to 10 maximum
- For wine menus, prioritize more expensive or notable wines

Return a JSON array where each object represents a wine with the fields above.
Format: [{wine1}, {wine2}, ...]. Do not include any markdown formatting or backticks.`
            },
            {
              type: "image_url",
              image_url: {
                url: imageUrl
              }
            }
          ]
        }
      ],
      max_tokens: 800,
      temperature: 0.5
    });

    let content = response.choices[0].message.content || '[]';
    console.log("Raw OpenAI Vision API response:", content);

    // Robust JSON Parsing Logic
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
        return []; // Return empty if not valid JSON array/object
      }
    } catch (parseError) {
      console.error("Error parsing JSON from OpenAI:", parseError);
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
    return [];
  }
}

// Generate AI-based wine summary, ratings, pairings, and price info
async function generateWineSummary(wineInfo: WineInfoInput): Promise<{ 
  summary: string, 
  score: number, 
  pairings: string[],
  estimatedPrice: string,
  valueRatio: number,
  valueAssessment: string,
  flavorProfile: { [key: string]: number }
}> {
  try {
    const wineDescription = `${wineInfo.vintage || ''} ${wineInfo.producer || ''} ${wineInfo.name || ''} ${wineInfo.region || ''} ${wineInfo.varietal || ''}`.trim();
    
    const prompt = `You are a wine expert. Based on what you know about the following wine: ${wineDescription}, please provide:

1. A sophisticated yet concise single-paragraph summary of the likely characteristics, flavors, and quality of this wine.

2. An estimated rating on a scale of 0-100, using the full range of the scale. Low quality wines should get scores between 50-75, average wines 76-85, good wines 86-90, excellent wines 91-95, and exceptional wines 96-100. Be discriminating and use the full range.

3. Food pairing suggestions (3-5 specific dishes that would pair well).

4. An estimated price range in USD (provide a realistic range based on the wine's quality, vintage, region, and varietal).

5. A value ratio score from 1-10 where 10 means exceptional value for money and 1 means overpriced.

6. A brief value assessment (1-2 sentences explaining the price-to-quality relationship).

7. A flavor profile represented as a JSON object with numerical scores from 1-10 for: fruitiness, acidity, tannin, body, sweetness, and oak.

Return your response in this JSON format:
{
  "summary": "your summary here",
  "score": numerical_score,
  "pairings": ["dish 1", "dish 2", "dish 3"],
  "estimatedPrice": "$XX - $YY",
  "valueRatio": number,
  "valueAssessment": "brief assessment of value",
  "flavorProfile": {
    "fruitiness": number,
    "acidity": number,
    "tannin": number,
    "body": number,
    "sweetness": number,
    "oak": number
  }
}

If there's insufficient information, provide reasonable estimates based on the varietal, region, or producer reputation if known.`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 800,
      temperature: 0.7,
      response_format: { type: "json_object" }
    });

    const content = response.choices[0]?.message?.content || '{}';
    const result = JSON.parse(content);
    
    return { 
      summary: result.summary || "No summary available",
      score: result.score || 85,
      pairings: result.pairings || ["Beef dishes", "Hard cheeses", "Roasted vegetables"],
      estimatedPrice: result.estimatedPrice || "$15 - $25",
      valueRatio: result.valueRatio || 5,
      valueAssessment: result.valueAssessment || "Average value for the price point",
      flavorProfile: result.flavorProfile || {
        fruitiness: 5,
        acidity: 5,
        tannin: 5,
        body: 5,
        sweetness: 5,
        oak: 5
      }
    };
  } catch (error) {
    console.error('Error generating wine summary:', error);
    return { 
      summary: "Failed to generate summary", 
      score: 85,
      pairings: ["Beef dishes", "Hard cheeses", "Roasted vegetables"],
      estimatedPrice: "$15 - $25",
      valueRatio: 5,
      valueAssessment: "Average value for the price point",
      flavorProfile: {
        fruitiness: 5,
        acidity: 5,
        tannin: 5,
        body: 5,
        sweetness: 5,
        oak: 5
      }
    };
  }
}

// Generate web snippets for a wine using OpenAI
async function generateWebSnippets(wineInfo: WineInfoInput): Promise<string> {
  try {
    const wineDescription = `${wineInfo.vintage || ''} ${wineInfo.producer || ''} ${wineInfo.name || ''} ${wineInfo.region || ''} ${wineInfo.varietal || ''}`.trim();
    
    // Skip generation if we don't have enough information
    if (wineDescription.length < 5 || !wineInfo.name) {
      console.log('Insufficient wine information for web snippets generation');
      return 'No web results found.';
    }
    
    const prompt = `You are a wine critic with expert knowledge. For the wine "${wineDescription}", generate 3-4 realistic review snippets that would appear on popular wine review sites.

Each snippet MUST:
1. Begin with the source name followed by a colon (e.g., "Wine Enthusiast: ...")
2. Use these sources: Vivino, Wine Enthusiast, Decanter, Wine Spectator, or James Suckling
3. Be 1-3 sentences long and include specific flavor notes, characteristics, and sometimes ratings
4. Use different writing styles for each source to feel authentic
5. Reflect the wine's qualities based on vintage, region, and varietal when known

Format as plain text with each snippet on a new line, starting with the source name. 

Example format:
Wine Enthusiast: Rich and complex with notes of blackberry and vanilla. The tannins are silky and the finish is long. 92 points.
Vivino: Dark fruits dominate with a hint of oak and spice. Medium-bodied with good structure.
Decanter: Elegant and well-balanced showing remarkable complexity for its price point. Notes of cherry and tobacco lead to a pleasant finish.`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 500,
      temperature: 0.7
    });

    const snippets = response.choices[0]?.message?.content || 'No web results found.';
    
    // Validate the response to ensure it has the correct format
    const lines = snippets.split('\n').filter(line => line.trim().length > 0);
    if (lines.length < 2 || !lines.some(line => line.includes(':'))) {
      console.log('Invalid snippet format received, regenerating...');
      // If we got an invalid format, you could retry once, but for now we'll just return a message
      return 'No reliable web snippets found for this wine.';
    }
    
    return snippets;
  } catch (error) {
    console.error('Error generating web snippets:', error);
    return 'Error retrieving web snippets.';
  }
}

// Cloud Function to analyze wine from image
export const analyzeWine = functions
  .region('us-central1')
  .https.onCall(async (data, context) => {
  try {
    const { image } = data;
    
    if (!image) {
      throw new functions.https.HttpsError('invalid-argument', 'No image provided');
    }

    // Generate a unique ID for this analysis job
    const jobId = uuidv4();
    const requestId = uuidv4();
    console.log(`[${requestId}] [${jobId}] Starting wine analysis process...`);

    let imageUrl = '';
    
    try {
      // Only try to use Firestore if it's available
      if (db) {
        // Create document in Firestore for tracking job status
        // Add size limit warning to avoid large documents
        await db.collection('jobs').doc(jobId).set({
          status: 'uploading',
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          requestId,
          // Important metadata field to indicate we should be careful about document size
          metaData: {
            sizeLimitEnforced: true,
            version: '1.0.1'
          }
        });
      }
      
      // Handle image storage - either use Firebase Storage or a data URL
      if (bucket) {
        // Upload image to Firebase Storage
        console.log(`[${requestId}] [${jobId}] Uploading image to Firebase Storage...`);
        const imageData = image.includes(',') ? image.split(',')[1] : image;
        const buffer = Buffer.from(imageData, 'base64');
        const file = bucket.file(`wine-images/${jobId}.jpg`);
        
        await file.save(buffer, {
          metadata: {
            contentType: 'image/jpeg'
          }
        });

        // Get the public URL for the image
        const [metadata] = await file.getMetadata();
        imageUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(file.name)}?alt=media&token=${metadata.metadata.firebaseStorageDownloadTokens}`;
      } else {
        // Fallback to using a data URL
        imageUrl = `data:image/jpeg;base64,${image.includes(',') ? image.split(',')[1] : image}`;
      }
      
      // Update job status if Firestore is available
      if (db) {
        // Store only the image URL reference, not the actual image data
        // to prevent exceeding Firestore document size limits
        await db.collection('jobs').doc(jobId).update({
          status: 'processing',
          // Store only the URL, never raw image data in Firestore
          imageUrl: imageUrl.startsWith('data:') ? 'image_uploaded_as_data_url' : imageUrl,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          processingStartedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }
    } catch (error) {
      console.error(`[${requestId}] [${jobId}] Error with storage/database:`, error);
      // Continue processing even if storage/database fails
    }
    
    // Direct analysis without storage if URL is empty
    if (!imageUrl) {
      imageUrl = `data:image/jpeg;base64,${image.includes(',') ? image.split(',')[1] : image}`;
    }

    // Analyze the image
    console.log(`[${requestId}] [${jobId}] Analyzing image with OpenAI...`);
    const wines = await analyzeImageWithOpenAI(imageUrl);
    
    if (!wines || wines.length === 0) {
      console.log(`[${requestId}] [${jobId}] No wines detected in the image`);
      
      // Update Firestore if available
      if (db) {
        await db.collection('jobs').doc(jobId).update({
          status: 'completed',
          result: { 
            wines: [],
            message: 'No wines detected in the image'
          },
          // Make sure we're not storing the actual image data in Firestore
          imageUrl: imageUrl.startsWith('data:') ? 'image_uploaded_as_data_url' : imageUrl,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          completedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }
      
      return { jobId, status: 'completed', data: { wines: [] } };
    }

    console.log(`[${requestId}] [${jobId}] Detected ${wines.length} wines in the image`);
    
    // Process each wine
    const processedWines = await Promise.all(wines.map(async (wine) => {
      console.log(`[${requestId}] [${jobId}] Processing wine: ${wine.name}`);
      
      // Get wine summary, score, pairings, and other enhanced details
      const { 
        summary, 
        score, 
        pairings, 
        estimatedPrice, 
        valueRatio, 
        valueAssessment,
        flavorProfile 
      } = await generateWineSummary(wine);
      
      // Get web snippets for this wine
      console.log(`[${requestId}] [${jobId}] Generating web snippets for: ${wine.name}`);
      const webSnippets = await generateWebSnippets(wine);
      
      // For restaurant menus, add restaurant context if available
      const isRestaurantMenu = wines.length > 2 && !wine.imageUrl;
      
      return {
        ...wine,
        score,
        tastingNotes: summary,
        webSnippets,
        imageUrl,
        // New enhanced details
        pairings,
        estimatedPrice,
        valueRatio,
        valueAssessment,
        flavorProfile,
        isFromMenu: isRestaurantMenu
      };
    }));

    // Store results in Firestore if available, but avoid storing large data
    if (db) {
      console.log(`[${requestId}] [${jobId}] Storing results in Firestore...`);
      
      try {
        // Extract only essential data for storage in Firestore, exclude base64 data
        const essentialWineData = processedWines.map(wine => ({
          name: wine.name || '',
          vintage: wine.vintage || '',
          producer: wine.producer || '',
          region: wine.region || '',
          varietal: wine.varietal || '',
          score: wine.score,
          // Limit tasting notes to reasonable size
          tastingNotes: (wine.tastingNotes || '').substring(0, 500),
          // Limit web snippets to reasonable size
          webSnippets: (wine.webSnippets || '').substring(0, 500),
          estimatedPrice: wine.estimatedPrice,
          valueRatio: wine.valueRatio,
          // Limit value assessment to reasonable size
          valueAssessment: (wine.valueAssessment || '').substring(0, 200),
          // Include only the most important flavor profile attributes
          flavorProfile: {
            fruitiness: wine.flavorProfile?.fruitiness || 5,
            acidity: wine.flavorProfile?.acidity || 5,
            body: wine.flavorProfile?.body || 5,
          },
          isFromMenu: wine.isFromMenu
        }));
        
        // Store minimal data in the main document
        await db.collection('jobs').doc(jobId).update({
          status: 'completed',
          // Store only an abbreviated summary
          resultSummary: {
            wineCount: essentialWineData.length,
            wineNames: essentialWineData.map(w => w.name),
            imageUrl: imageUrl.startsWith('data:') ? 'image_uploaded_as_data_url' : imageUrl,
          },
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          completedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        // Then store detailed data in a separate document
        // Breaking it up to avoid the 1MB limit
        await db.collection('jobs').doc(`${jobId}_details`).set({
          wines: essentialWineData,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        console.log(`[${requestId}] [${jobId}] Successfully stored results in separate documents`);
      } catch (error) {
        console.error(`[${requestId}] [${jobId}] Error storing results:`, error);
        
        // Fallback: store absolute minimum data if we hit size limits
        await db.collection('jobs').doc(jobId).update({
          status: 'completed',
          resultMinimal: {
            wineCount: processedWines.length,
            wineNames: processedWines.map(w => w.name || 'Unknown wine'),
            message: 'Full data exceeded size limits. Only basic information is available.'
          },
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          completedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }
    }

    console.log(`[${requestId}] [${jobId}] Analysis completed successfully`);
    
    // Return the job ID and status
    return { 
      jobId, 
      status: 'completed', 
      data: { 
        wines: processedWines,
        imageUrl 
      } 
    };
  } catch (error: any) {
    console.error(`Error processing wine analysis:`, error);
    
    // Provide more detailed error message based on error type
    if (error.code === 'invalid_api_key') {
      throw new functions.https.HttpsError(
        'unauthenticated',
        'Invalid OpenAI API key. Please check your API key configuration.'
      );
    } else if (error.status === 401) {
      throw new functions.https.HttpsError(
        'unauthenticated',
        'Authentication error with OpenAI API. Check your API key.'
      );
    } else if (error.code === 'not-found' || error.message?.includes('not found')) {
      // For Firestore or Storage not found errors
      console.log('Returning empty result instead of error for not found');
      // Return an empty result instead of throwing an error
      return { 
        jobId: uuidv4(), 
        status: 'completed', 
        data: { 
          wines: [],
          message: 'No wines could be detected in the image.'
        } 
      };
    } else {
      throw new functions.https.HttpsError(
        'internal', 
        error.message || 'Failed to process image'
      );
    }
  }
});

// Function to get analysis results by jobId
export const getAnalysisResult = functions
  .region('us-central1')
  .https.onCall(async (data, context) => {
  try {
    const { jobId } = data;
    
    if (!jobId) {
      throw new functions.https.HttpsError('invalid-argument', 'No job ID provided');
    }

    // Only try to use Firestore if it's available
    if (db) {
      try {
        // Get the main job document
        const docRef = db.collection('jobs').doc(jobId);
        const doc = await docRef.get();
        
        if (!doc.exists) {
          return { status: 'not_found', data: null };
        }
        
        const jobData = doc.data();
        
        // Check if we have detailed data in a separate document
        if (jobData?.status === 'completed') {
          try {
            // Try to get the detailed results from the separate document
            const detailsRef = db.collection('jobs').doc(`${jobId}_details`);
            const detailsDoc = await detailsRef.get();
            
            if (detailsDoc.exists) {
              const detailsData = detailsDoc.data();
              
              // Combine the data from both documents
              return {
                status: jobData.status,
                data: {
                  wines: detailsData?.wines || [],
                  imageUrl: jobData.resultSummary?.imageUrl || jobData.imageUrl,
                  completedAt: jobData.completedAt
                }
              };
            }
          } catch (detailsError) {
            console.error(`Error retrieving details for job ${jobId}:`, detailsError);
            // Continue with main document data if details retrieval fails
          }
          
          // If we have resultSummary but couldn't get details, return that
          if (jobData.resultSummary) {
            return {
              status: jobData.status,
              data: {
                wines: jobData.resultSummary.wineNames.map((name: string) => ({ name })),
                imageUrl: jobData.resultSummary.imageUrl,
                message: 'Limited data available. Full details could not be retrieved.'
              }
            };
          }
          
          // Fall back to result or resultMinimal if they exist
          return {
            status: jobData.status,
            data: jobData.result || jobData.resultMinimal || {
              wines: [],
              message: 'Wine data was processed but details are not available.'
            }
          };
        }
        
        // For jobs that aren't completed, return the status
        return {
          status: jobData?.status || 'unknown',
          data: jobData?.result || null
        };
      } catch (error) {
        console.error('Error retrieving from Firestore:', error);
        // Fall through to the default response
      }
    }
    
    // If Firestore not available or error occurred, return a not_found status
    return { 
      status: 'not_found', 
      data: null,
      message: "Firestore not available for job tracking"
    };
  } catch (error: any) {
    console.error('Error retrieving analysis result:', error);
    throw new functions.https.HttpsError(
      'internal',
      error.message || 'Failed to retrieve analysis result'
    );
  }
});