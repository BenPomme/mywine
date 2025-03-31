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

  console.log(`Checking status for Job ID: ${jobId}`);

  try {
    // Fetch the job data from Vercel KV
    const result = await kv.get<JobResult>(jobId);

    if (!result) {
      console.log(`Job ID not found: ${jobId}`);
      return res.status(404).json({ status: 'not_found', message: `Job ID ${jobId} not found.` });
    }

    console.log(`Job ID ${jobId} status: ${result.status}`);

    // Return the status and the rest of the data
    const { status, ...data } = result;
    return res.status(200).json({ status, data });

  } catch (error: any) {
    console.error(`Error fetching status for Job ID ${jobId}:`, error);
    return res.status(500).json({ 
        status: 'not_found', // Or maybe a different status like 'error'?
        message: 'Error fetching job status.'
    });
  }
} 