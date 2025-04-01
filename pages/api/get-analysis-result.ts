import type { NextApiRequest, NextApiResponse } from 'next';
import { kv } from '@vercel/kv';
import { v4 as uuidv4 } from 'uuid';

// Define the expected structure of the data stored in KV
interface JobResult {
  status: 'uploading' | 'processing' | 'completed' | 'failed' | 'trigger_failed';
  error?: string;
  imageUrl?: string;
  result?: {
    wines?: any[];
    status?: string;
    imageUrl?: string;
    completedAt?: string;
  };
  wines?: any[]; // For backward compatibility
  updatedAt?: string;
  createdAt?: string;
  completedAt?: string;
  failedAt?: string;
}

// Define the response type for this API route
type StatusApiResponse = {
  success: boolean;
  status: JobResult['status'] | 'not_found';
  message?: string;
  data?: any; // Return all data 
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
    const jobData = await kv.hgetall(`job:${jobId}`);
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

    // Extract wines from either the result object or the direct wines property
    const wines = job.result?.wines || job.wines || [];

    // Return the current status and any available data
    return res.status(200).json({
      success: true,
      status: job.status,
      data: {
        error: job.error,
        imageUrl: job.imageUrl || job.result?.imageUrl,
        wines: wines,
        updatedAt: job.updatedAt,
        createdAt: job.createdAt,
        completedAt: job.completedAt || job.result?.completedAt
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