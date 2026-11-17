import { GoogleGenAI, Type } from '@google/genai';
import { db, getDepartmentIdForCategory } from './db.ts';
import { haversineMeters } from './places.ts';

const VALID_CATEGORIES = [
  'Roads and Potholes',
  'Waste Management',
  'Drainage and Waterlogging',
  'Traffic and Road Obstructions',
  'Medical Assistance',
  'Women and Child Safety',
  'Road Accident',
  'Animal Rescue',
  'Other Civic Issues',
] as const;

export interface AiAnalysisResult {
  available: boolean;
  error?: string;
  suggestedCategory?: string;
  suggestedSeverity?: 'Low' | 'Medium' | 'High' | 'Critical';
  suggestedTitle?: string;
  suggestedDescription?: string;
  summary?: string;
  recommendedDepartmentId?: string;
  recommendedDepartmentName?: string;
  confidence?: number;
  potentialDuplicates: Array<{
    id: string;
    tracking_code: string;
    title: string;
    category: string;
    status: string;
    distance_meters: number | null;
    created_at: string;
  }>;
}

export function findPotentialDuplicates(params: {
  category?: string;
  title?: string;
  latitude?: number | null;
  longitude?: number | null;
}) {
  const recentReports = db.prepare(`
    SELECT r.id, r.tracking_code, r.title, r.category, r.status, r.created_at,
           rl.latitude, rl.longitude
    FROM reports r
    LEFT JOIN report_locations rl ON rl.report_id = r.id
    WHERE r.status NOT IN ('REJECTED', 'RESOLVED')
      AND datetime(r.created_at) >= datetime('now', '-14 days')
    ORDER BY r.created_at DESC
    LIMIT 100
  `).all() as any[];

  const duplicates: AiAnalysisResult['potentialDuplicates'] = [];
  const titleWords = (params.title || '').toLowerCase().split(/\s+/).filter((w) => w.length > 3);

  for (const r of recentReports) {
    let dist: number | null = null;
    if (
      typeof params.latitude === 'number' &&
      typeof params.longitude === 'number' &&
      typeof r.latitude === 'number' &&
      typeof r.longitude === 'number'
    ) {
      dist = Math.round(haversineMeters(params.latitude, params.longitude, r.latitude, r.longitude));
    }

    const sameCategory = !params.category || r.category === params.category;
    const nearby = dist !== null && dist <= 300;
    const rTitleLower = String(r.title || '').toLowerCase();
    const wordOverlap = titleWords.some((w) => rTitleLower.includes(w));

    if ((sameCategory && nearby) || (sameCategory && wordOverlap)) {
      duplicates.push({
        id: r.id,
        tracking_code: r.tracking_code,
        title: r.title,
        category: r.category,
        status: r.status,
        distance_meters: dist,
        created_at: r.created_at,
      });
    }
  }

  return duplicates.slice(0, 5);
}

export async function analyzeCivicReportWithAI(params: {
  description?: string;
  title?: string;
  selectedCategory?: string;
  imageBase64?: string;
  imageMimeType?: string;
  latitude?: number | null;
  longitude?: number | null;
}): Promise<AiAnalysisResult> {
  const potentialDuplicates = findPotentialDuplicates({
    category: params.selectedCategory,
    title: params.title,
    latitude: params.latitude,
    longitude: params.longitude,
  });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return {
      available: false,
      error: 'AI Civic Intelligence is currently unconfigured (GEMINI_API_KEY not set). Manual reporting remains fully functional.',
      potentialDuplicates,
    };
  }

  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const parts: any[] = [];
    if (params.imageBase64 && params.imageMimeType) {
      const cleanedBase64 = params.imageBase64.replace(/^data:[^;]+;base64,/, '');
      parts.push({
        inlineData: {
          mimeType: params.imageMimeType,
          data: cleanedBase64,
        },
      });
    }

    parts.push({
      text: `Analyze this Indian smart city civic/safety report and provide structured triage suggestions for citizen review (NOT an enforcement decision).
Citizen-entered title: ${params.title || 'Not provided yet'}
Citizen-entered description: ${params.description || 'Not provided yet'}
Citizen-selected category: ${params.selectedCategory || 'Not selected yet'}

Choose the best category strictly from: ${VALID_CATEGORIES.join(', ')}.
Choose severity strictly from: Low, Medium, High, Critical.`,
    });

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: { parts },
      config: {
        systemInstruction:
          'You are SEVA AI Civic Intelligence Engine for Indian municipalities. Provide accurate, neutral, concise suggestions for citizen civic issue reports. Always output valid JSON matching the schema.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            suggestedCategory: {
              type: Type.STRING,
              description: 'Best matching category from the allowed list.',
            },
            suggestedSeverity: {
              type: Type.STRING,
              description: 'Low, Medium, High, or Critical.',
            },
            suggestedTitle: {
              type: Type.STRING,
              description: 'Concise 5-10 word civic incident title.',
            },
            suggestedDescription: {
              type: Type.STRING,
              description: 'Clear 1-2 sentence description based on visual evidence and user context.',
            },
            summary: {
              type: Type.STRING,
              description: '1-sentence triage summary for municipal officers.',
            },
            confidence: {
              type: Type.NUMBER,
              description: 'Confidence score between 0 and 1.',
            },
          },
        },
      },
    });

    const parsed = JSON.parse((response.text || '{}').trim());
    const cat = VALID_CATEGORIES.includes(parsed.suggestedCategory)
      ? parsed.suggestedCategory
      : params.selectedCategory && VALID_CATEGORIES.includes(params.selectedCategory as any)
        ? params.selectedCategory
        : 'Roads and Potholes';

    const sevList = ['Low', 'Medium', 'High', 'Critical'];
    const sev = sevList.includes(parsed.suggestedSeverity) ? parsed.suggestedSeverity : 'Medium';

    const deptId = getDepartmentIdForCategory(cat);
    const dept = db.prepare('SELECT name FROM departments WHERE id = ?').get(deptId) as { name: string } | undefined;

    return {
      available: true,
      suggestedCategory: cat,
      suggestedSeverity: sev as any,
      suggestedTitle: parsed.suggestedTitle || params.title || '',
      suggestedDescription: parsed.suggestedDescription || params.description || '',
      summary: parsed.summary || '',
      recommendedDepartmentId: deptId,
      recommendedDepartmentName: dept?.name || 'Emergency Control Room',
      confidence: typeof parsed.confidence === 'number' ? Math.min(1, Math.max(0, parsed.confidence)) : 0.78,
      potentialDuplicates,
    };
  } catch (err: any) {
    return {
      available: false,
      error: err?.message || 'AI analysis failed temporarily. Manual reporting remains fully functional.',
      potentialDuplicates,
    };
  }
}

export async function analyzeCivicTrendsWithAI(reportsSummaryInput: string): Promise<{ available: boolean; insights?: string; error?: string }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return { available: false, error: 'GEMINI_API_KEY is not configured.' };
  }
  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `Summarize operational trends and priority action recommendations for municipal authorities based strictly on these real database metrics (do not invent any numbers):\n${reportsSummaryInput}`,
    });
    return { available: true, insights: response.text || '' };
  } catch (err: any) {
    return { available: false, error: err?.message || 'Failed to generate AI trend analysis.' };
  }
}
