# Wine Picker

A modern web application that analyzes wine labels and menus using AI, providing detailed information, ratings, and expert opinions.

## Features

- Upload images of wine labels or menus
- AI-powered analysis using OpenAI's GPT-4o Vision API
- Estimate wine quality and characteristics based on identified wine attributes
- Generate sophisticated descriptions of wines based on their properties
- Display wine details, estimated ratings, and AI-generated summaries
- Apple-inspired clean, responsive UI design

## Technologies

- **Next.js**: React framework for server-rendered applications
- **TypeScript**: Static typing for better developer experience
- **Tailwind CSS**: Utility-first CSS framework
- **OpenAI API (GPT-4o)**: For image analysis and wine information generation
- **Vercel KV**: For storing analysis results
- **Vercel Blob**: For storing uploaded images

## Getting Started

### Prerequisites

- Node.js 14.x or later
- NPM or Yarn package manager
- OpenAI API key
- Vercel account for KV and Blob storage

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/your-username/wine-picker-next.git
   cd wine-picker-next
   ```

2. Install dependencies:
   ```bash
   npm install
   # or
   yarn install
   ```

3. Create a `.env.local` file in the root directory with your API keys:
   ```
   OPENAI_API_KEY=your_openai_api_key_here
   ```

4. For local development with Vercel KV, you'll need to link your project to Vercel and pull the environment variables:
   ```bash
   vercel link
   vercel env pull .env.local
   ```

5. Start the development server:
   ```bash
   npm run dev
   # or
   yarn dev
   ```

6. Open [http://localhost:3000](http://localhost:3000) in your browser to see the application.

## Deployment to Vercel

The application is designed to be deployed on Vercel to leverage KV and Blob storage:

1. Push your code to GitHub
2. Import the repository to Vercel
3. Configure the environment variables in Vercel:
   - `OPENAI_API_KEY`: Your OpenAI API key

4. Add the Vercel KV integration to your project
5. Add the Vercel Blob integration to your project
6. Deploy the application

```bash
vercel --prod
```

## Project Structure

- `/pages`: Page components and API routes
- `/components`: Reusable React components
- `/utils`: Utility functions and type definitions
- `/public`: Static assets
- `/styles`: Global styles

## API Routes

The application uses Next.js API routes to securely handle external API calls:

- `/api/analyze-wine`: Handles image upload and initiates wine analysis with OpenAI
- `/api/get-analysis-result`: Retrieves the results of the wine analysis

## Environment Variables

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | Your OpenAI API key for image analysis |
| `KV_URL` | URL for Vercel KV (set automatically by Vercel) |
| `KV_REST_API_URL` | REST API URL for Vercel KV (set automatically by Vercel) |
| `KV_REST_API_TOKEN` | Auth token for Vercel KV (set automatically by Vercel) |

## License

This project is licensed under the MIT License - see the LICENSE file for details. 