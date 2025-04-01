import type { NextApiRequest, NextApiResponse } from 'next';
import { put } from '@vercel/blob';
import { kv } from '@vercel/kv';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios'; // Keep axios for triggering Netlify function

// Define response type for this initial trigger API
type TriggerApiResponse = {
  success: boolean;
  message?: string;
  status?: 'processing' | 'failed';
  jobId?: string;
  requestId?: string; // Include original request ID for tracing
};

// Replace placeholder with actual Netlify Background Function URL
const NETLIFY_BACKGROUND_FUNCTION_URL = 'https://ilovewine.netlify.app/.netlify/functions/process-wine-analysis'; 

// Simple validation for base64 image (can be expanded)
function validateBase64Image(base64String: string): boolean {
  if (!base64String || typeof base64String !== 'string') return false;
  // Basic regex check (might need refinement)
  if (!/^data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/=]+$/.test(base64String)) {
    // Also allow raw base64 string if frontend sends that
    if (!/^[A-Za-z0-9+/=]+$/.test(base64String)) {
        return false;
    }
  }
  // Check size (crude estimate, limit ~10MB)
  if (base64String.length > 10 * 1024 * 1024 * 4/3) { 
    return false;
  }
  return true;
}

// Helper to convert base64 data URL to Blob
function dataURLtoBlob(dataurl: string): Blob | null {
  try {
    const arr = dataurl.split(',');
    if (arr.length < 2) return null; 
    const mimeMatch = arr[0].match(/:(.*?);/);
    if (!mimeMatch || mimeMatch.length < 2) return null;
    const mime = mimeMatch[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while(n--){
        u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], {type:mime});
  } catch (e) {
    console.error("Error converting data URL to Blob:", e);
    return null;
  }
}


export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<TriggerApiResponse> // Updated response type
) {
  // Use a request ID for tracking across services
  const requestId = uuidv4(); 
  console.log(`[${requestId}] Analyze request received`);

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed', requestId });
  }

  // --- Simplified Input Validation --- 
  const { image } = req.body;
  if (!image) {
    return res.status(400).json({ success: false, message: 'No image provided', requestId });
  }
  // Crude validation, assuming frontend sends raw base64 or data URL
  // if (!validateBase64Image(image)) {
  //   return res.status(400).json({ success: false, message: 'Invalid image format or size', requestId });
  // }

  // --- Generate Job ID --- 
  const jobId = uuidv4();
  console.log(`[${requestId}] Generated Job ID: ${jobId}`);

  // Set the jobId in the response headers immediately
  res.setHeader('x-job-id', jobId);

  try {
    // --- 1. Initial KV Status --- 
    await kv.set(jobId, { status: 'uploading', requestTimestamp: Date.now() }, { ex: 3600 }); // Set TTL (e.g., 1 hour)
    console.log(`[${requestId}] [${jobId}] Initial status set to 'uploading' in KV`);

    // --- 2. Upload Image to Vercel Blob --- 
    console.log(`[${requestId}] [${jobId}] Uploading image to Vercel Blob...`);
    // Ensure we handle both raw base64 and data URLs
    let imageBlob: Blob | null;
    let fileExtension = 'jpg'; // Default extension
    let base64Data = image;

    if (image.startsWith('data:image')) {
      const mimeMatch = image.match(/^data:image\/([a-zA-Z]+);base64,/);
      if (mimeMatch && mimeMatch[1]) {
        fileExtension = mimeMatch[1];
      }
      imageBlob = dataURLtoBlob(image);
    } else {
      // Assuming raw base64 if no data URL prefix
      try {
          const buffer = Buffer.from(image, 'base64');
          // Attempt to infer type, default to jpg
          // This is very basic, might need a library for real mime type detection if needed
          imageBlob = new Blob([buffer], { type: 'image/jpeg' }); 
      } catch(e) {
          console.error(`[${requestId}] [${jobId}] Error creating Blob from raw base64:`, e);
          imageBlob = null;
      }
    }

    if (!imageBlob) {
      throw new Error('Failed to process image data for upload.');
    }
    
    const filename = `${jobId}.${fileExtension}`; 
    const blobResult = await put(filename, imageBlob, {
      access: 'public', // Make it publicly accessible for Netlify function
      contentType: imageBlob.type, // Set content type
    });
    console.log(`[${requestId}] [${jobId}] Image uploaded to Vercel Blob: ${blobResult.url}`);

    // --- 3. Trigger Netlify Background Function --- 
    console.log(`[${requestId}] [${jobId}] Triggering Netlify Background Function at ${NETLIFY_BACKGROUND_FUNCTION_URL}...`);
    try {
        // Prepare request body
        const requestBody = {
            jobId: jobId,
            imageUrl: blobResult.url,
            requestId: requestId
        };
        console.log(`[${requestId}] [${jobId}] Request body:`, JSON.stringify(requestBody, null, 2));

        // Send jobId and the public URL of the image
        const netlifyResponse = await axios.post(NETLIFY_BACKGROUND_FUNCTION_URL, requestBody, {
            headers: {
                'Content-Type': 'application/json'
            }
        });
        console.log(`[${requestId}] [${jobId}] Netlify function response:`, {
            status: netlifyResponse.status,
            data: netlifyResponse.data,
            headers: netlifyResponse.headers
        });
    } catch (triggerError: any) {
        console.error(`[${requestId}] [${jobId}] Error triggering Netlify function:`, {
            message: triggerError.message,
            response: triggerError.response?.data,
            status: triggerError.response?.status,
            requestBody: {
                jobId,
                imageUrl: blobResult.url,
                requestId
            }
        });
        // Decide how to handle trigger failure. Maybe update KV status to 'trigger_failed'?
        await kv.set(jobId, { 
          status: 'trigger_failed', 
          error: 'Failed to trigger background processing',
          imageUrl: blobResult.url, // Store URL even if trigger failed
          errorDetails: triggerError.response?.data || triggerError.message
        }, { ex: 3600 });
        // Return failure to the client
        return res.status(500).json({ 
            success: false, 
            message: 'Failed to start background analysis job.',
            status: 'failed',
            jobId: jobId,
            requestId
        });
    }

    // --- 4. Update KV Status to Processing --- 
    await kv.set(jobId, { 
        status: 'processing', 
        imageUrl: blobResult.url, // Store the image URL with the status
        processingTimestamp: Date.now() 
    }, { ex: 3600 }); 
    console.log(`[${requestId}] [${jobId}] Status updated to 'processing' in KV.`);

    // --- 5. Return Success Response --- 
    // Use 202 Accepted status code to indicate the request was accepted 
    // but processing is not complete.
    return res.status(202).json({ 
        success: true, 
        status: 'processing', 
        jobId: jobId,
        requestId 
    });

  } catch (error: any) {
    console.error(`[${requestId}] [${jobId || 'N/A'}] Error in analysis trigger API:`, error);
    // Update KV if possible to indicate failure
    if (jobId) {
        await kv.set(jobId, { status: 'failed', error: error.message || 'Unknown error during setup' }, { ex: 3600 });
    }
    return res.status(500).json({ 
        success: false, 
        message: 'An internal server error occurred.', 
        status: 'failed',
        jobId: jobId || undefined,
        requestId 
    });
  }
}

// Remove the old processing functions and config
/* 
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb', // Keep if needed for base64 upload
    },
  },
}; 
*/

// Remove all the old wine processing functions like analyzeImageWithOpenAI, 
// getWineReviews, extractRatingFromReviews, estimateScoreFromReviews, etc.
// They will live in the Netlify function now. 