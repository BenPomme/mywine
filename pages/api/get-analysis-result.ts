import type { NextApiRequest, NextApiResponse } from 'next';
import { kv } from '@vercel/kv';

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
  status: JobResult['status'] | 'not_found';
  message?: string;
  data?: Omit<JobResult, 'status'>; // Return all data except the status itself
  details?: string; // Add details property for error responses
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<StatusApiResponse>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ status: 'not_found', message: 'Method Not Allowed' });
  }

  const { jobId } = req.query;

  if (!jobId || typeof jobId !== 'string') {
    return res.status(400).json({ status: 'not_found', message: 'Missing or invalid jobId parameter' });
  }

  try {
    console.log(`[${jobId}] Attempting to fetch job data from KV...`);
    
    // Verify KV connection
    try {
      await kv.ping();
      console.log(`[${jobId}] KV connection successful`);
    } catch (error) {
      console.error(`[${jobId}] KV connection failed:`, error);
      return res.status(500).json({ status: 'not_found', message: 'Failed to connect to KV store' });
    }

    // Fetch job data
    const jobData = await kv.get(jobId);
    console.log(`[${jobId}] Raw KV data:`, JSON.stringify(jobData, null, 2));

    if (!jobData) {
      console.log(`[${jobId}] No job data found in KV`);
      return res.status(404).json({ status: 'not_found', message: 'Job not found' });
    }

    // Parse the job data
    const parsedData = typeof jobData === 'string' ? JSON.parse(jobData) : jobData;
    console.log(`[${jobId}] Parsed job data:`, JSON.stringify(parsedData, null, 2));

    // Check job status
    const status = parsedData.status;
    console.log(`[${jobId}] Current job status:`, status);

    if (status === 'completed') {
      console.log(`[${jobId}] Job completed, returning results`);
      return res.status(200).json(parsedData);
    } else if (status === 'failed') {
      console.log(`[${jobId}] Job failed, returning error`);
      return res.status(500).json({ 
        status: 'failed', 
        message: 'Analysis failed', 
        details: parsedData.error 
      });
    } else {
      console.log(`[${jobId}] Job still processing, current status:`, status);
      return res.status(202).json({ status: 'processing' });
    }
  } catch (error) {
    console.error(`[${jobId}] Error fetching job status:`, error);
    return res.status(500).json({ 
      status: 'not_found', 
      message: 'Failed to fetch job status',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
} 