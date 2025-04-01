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

type AnalyzeRequestBody = {
  image: string;
};

type AnalyzeResponseData = {
  jobId: string;
  status: string;
  requestId?: string;
  message?: string;
};

// Create a function to trigger the Netlify function without waiting for its response
const triggerNetlifyFunctionAsync = (url: string, data: any) => {
  // Use a fire-and-forget pattern
  axios.post(url, data)
    .then(response => {
      console.log('Netlify function executed successfully:', response.status);
    })
    .catch(error => {
      console.error('Error executing Netlify function:', error.message);
      // Attempt to update KV store with failure status (best effort)
      try {
        kv.hset(`job:${data.jobId}`, {
          status: 'trigger_failed',
          error: error.message,
          updatedAt: new Date().toISOString()
        }).catch(kvError => {
          console.error('Failed to update KV store with trigger failure:', kvError);
        });
      } catch (e) {
        console.error('Exception handling Netlify trigger failure:', e);
      }
    });
};

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
  console.log(`[${requestId}] Analyze request received`);

  try {
    const { image } = req.body as AnalyzeRequestBody;

    if (!image) {
      return res.status(400).json({ 
        status: 'error', 
        message: 'No image provided',
        jobId: '' 
      });
    }

    // Generate a unique job ID
    const jobId = uuidv4();
    console.log(`[${requestId}] Generated Job ID: ${jobId}`);

    // Set the job ID in the response headers immediately for client availability
    res.setHeader('x-job-id', jobId);

    // Create initial job status in KV store
    console.log(`[${requestId}] [${jobId}] Initial status set to 'uploading' in KV`);
    await kv.hset(`job:${jobId}`, {
      status: 'uploading',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      requestId
    });

    // Upload image to Blob storage
    console.log(`[${requestId}] [${jobId}] Uploading image to Vercel Blob...`);
    const imageData = image.split(',')[1]; // Remove data URL prefix
    const buffer = Buffer.from(imageData, 'base64');
    
    // Upload the image to Vercel Blob storage
    const { url } = await put(`${jobId}.jpg`, buffer, {
      access: 'public',
    });
    
    console.log(`[${requestId}] [${jobId}] Image uploaded to Vercel Blob: ${url}`);

    // Update KV store with processing status
    await kv.hset(`job:${jobId}`, {
      status: 'processing',
      imageUrl: url,
      updatedAt: new Date().toISOString(),
      processingStartedAt: new Date().toISOString()
    });

    // Prepare data for the Netlify function
    const netlifyFunctionData = {
      jobId,
      imageUrl: url,
      requestId
    };

    // Get the Netlify function URL from environment variable or use default
    const netlifyFunctionUrl = process.env.NETLIFY_FUNCTION_URL || 
      'https://ilovewine.netlify.app/.netlify/functions/process-wine-analysis';

    console.log(`[${requestId}] [${jobId}] Triggering Netlify Background Function at ${netlifyFunctionUrl}...`);
    
    // Trigger the Netlify function without waiting for response (fire and forget)
    triggerNetlifyFunctionAsync(netlifyFunctionUrl, netlifyFunctionData);

    // Return a success response immediately
    return res.status(202).json({
      jobId,
      status: 'processing',
      requestId,
      message: 'Analysis job started'
    });

  } catch (error: any) {
    console.error(`[${requestId}] Error processing analysis request:`, error);
    return res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to process image',
      jobId: ''
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