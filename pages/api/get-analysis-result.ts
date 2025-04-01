import type { NextApiRequest, NextApiResponse } from 'next';
import { kv } from '@vercel/kv';
import { v4 as uuidv4 } from 'uuid';

// Define the expected structure of the data stored in KV
interface JobResult {
  status: 'uploading' | 'processing' | 'processing_started' | 'completed' | 'failed' | 'trigger_failed';
  error?: string;
  imageUrl?: string;
  wines?: any[]; // Define a more specific type based on ProcessedWine if possible
  requestTimestamp?: number;
  processingTimestamp?: number;
  completionTimestamp?: number;
  durationMs?: number;
}

// Define the response type for this API route
type StatusApiResponse = {
  success: boolean;  // Add success property
  status: JobResult['status'] | 'not_found';
  message?: string;
  data?: Omit<JobResult, 'status'>; // Return all data except the status itself
  details?: string; // Add details property for error responses
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<StatusApiResponse>
) {
  const { jobId } = req.query;
  const requestId = uuidv4();

  if (!jobId || typeof jobId !== 'string') {
    console.error(`[${requestId}] Missing or invalid jobId in query parameters`);
    return res.status(400).json({ 
      success: false,
      message: 'Missing or invalid jobId parameter',
      status: 'not_found',
      details: 'No jobId provided in query parameters'
    });
  }

  try {
    console.log(`[${requestId}] Checking status for Job ID: ${jobId}`);
    
    // Verify KV connection
    try {
      await kv.ping();
      console.log(`[${requestId}] KV connection successful`);
    } catch (error) {
      console.error(`[${requestId}] KV connection failed:`, error);
      return res.status(500).json({ 
        success: false,
        message: 'Failed to connect to KV store',
        status: 'failed',
        details: 'KV connection error'
      });
    }

    // Fetch job data from KV
    const jobData = await kv.get(jobId);
    console.log(`[${requestId}] Raw KV data for job ${jobId}:`, JSON.stringify(jobData, null, 2));

    if (!jobData) {
      console.error(`[${requestId}] No data found for job ${jobId}`);
      return res.status(404).json({ 
        success: false,
        message: 'Job not found',
        status: 'not_found',
        details: 'No data found in KV store'
      });
    }

    // Type assertion for jobData
    const job = jobData as JobResult;
    console.log(`[${requestId}] Job status:`, job.status);
    console.log(`[${requestId}] Job details:`, JSON.stringify(job, null, 2));

    // Return the current status and any available data
    return res.status(200).json({
      success: true,
      status: job.status,
      data: {
        error: job.error,
        imageUrl: job.imageUrl,
        wines: job.wines,
        requestTimestamp: job.requestTimestamp,
        processingTimestamp: job.processingTimestamp,
        completionTimestamp: job.completionTimestamp,
        durationMs: job.durationMs
      }
    });

  } catch (error: any) {
    console.error(`[${requestId}] Error fetching job status:`, error);
    return res.status(500).json({ 
      success: false,
      message: 'Failed to fetch job status',
      status: 'failed',
      details: error.message
    });
  }
} 