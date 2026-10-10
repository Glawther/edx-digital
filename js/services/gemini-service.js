/**
 * Nexus CRM - Google Gemini AI Service
 * Generates deal insights, win probability, sales strategies and proposal drafts.
 */

import { recordAiUsage } from '../core/config.js';

const GEMINI_KEY_STORAGE = 'nexus_crm_gemini_api_key';

/**
 * Retrieves the stored Gemini API key
 */
export function getSavedGeminiKey() {
  return localStorage.getItem(GEMINI_KEY_STORAGE) || '';
}

/**
 * Saves or clears the Gemini API key
 */
export function saveGeminiKey(key) {
  if (key && key.trim()) {
    localStorage.setItem(GEMINI_KEY_STORAGE, key.trim());
  } else {
    localStorage.removeItem(GEMINI_KEY_STORAGE);
  }
}

/**
 * Analyzes a CRM customer / lead using Google Gemini AI
 * @param {Object} customer - The lead / customer object
 * @returns {Promise<Object>} Analysis results
 */
export async function analyzeDealWithGemini(customer) {
  const apiKey = getSavedGeminiKey();

  if (apiKey) {
    try {
      const result = await callGeminiAPI(customer, apiKey);
      recordAiUsage();
      return result;
    } catch (err) {
      console.warn("Gemini API call failed, falling back to smart analytical engine:", err);
      recordAiUsage();
      return generateHeuristicAnalysis(customer);
    }
  }

  // Fallback to high-quality smart analytical engine
  recordAiUsage();
  return generateHeuristicAnalysis(customer);
}

/**
 * Calls the Google Gemini REST API
 */
async function callGeminiAPI(customer, apiKey) {
  const prompt = `
Você é o Chief Revenue Officer (CRO) e especialista sênior em vendas B2B e CRM.
Analise a seguinte oportunidade comercial e responda em formato JSON estrito:

DADOS DO CLIENTE:
- Nome: ${customer.name || 'Não informado'}
- Empresa: ${customer.company || 'Não informada'}
- Cargo: ${customer.role || 'Não informado'}
- Valor da Oportunidade: R$ ${customer.dealValue || 0}
- Estágio no Funil: ${customer.stage || 'lead'}
- Prioridade: ${customer.priority || 'medium'}
- Tags: ${(customer.tags || []).join(', ')}
- Anotações: ${customer.notes || 'Sem anotações adicionais'}

FORMATO DE RESPOSTA OBRIGATÓRIO (JSON estrito):
{
  "probability": 75,
  "summary": "Resumo executivo do perfil e momento da oportunidade (máximo 2 parágrafos concisos).",
  "keyPoints": ["Ponto forte 1", "Ponto forte 2", "Ponto forte 3"],
  "objections": ["Possível objeção 1 e como contornar", "Possível objeção 2 e como contornar"],
  "recommendedAction": "Ação recomendada imediata para acelerar o fechamento.",
  "proposalEmail": "Assunto: ...\\n\\nOlá [Nome],\\n... rascunho de e-mail de proposta ou follow-up profissional em tom consultivo."
}
`;

  // Standard current Google Gemini models
  const models = ['gemini-2.0-flash', 'gemini-1.5-flash'];
  let lastError = null;

  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.7
          }
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const message = errorData?.error?.message || `HTTP ${response.status}`;
        throw new Error(message);
      }

      const data = await response.json();
      let textOutput = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!textOutput) {
        throw new Error("Resposta vazia da IA Gemini.");
      }

      // Robust Markdown JSON block stripper
      textOutput = textOutput.trim();
      if (textOutput.startsWith("```")) {
        textOutput = textOutput.replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
      }

      return JSON.parse(textOutput);
    } catch (err) {
      lastError = err;
      console.warn(`Tentativa com ${model} falhou:`, err.message);
    }
  }

  throw lastError || new Error("Falha ao comunicar com os modelos Gemini.");
}

/**
 * Smart Analytical Engine (Fallback when no key is entered)
 */
function generateHeuristicAnalysis(customer) {
  const val = Number(customer.dealValue) || 0;
  const stage = customer.stage || 'lead';
  const priority = customer.priority || 'medium';

  // Calculate realistic probability
  let baseProb = 20;
  if (stage === 'contact') baseProb = 35;
  if (stage === 'proposal') baseProb = 60;
  if (stage === 'negotiation') baseProb = 85;
  if (stage === 'won') baseProb = 100;
  if (stage === 'lost') baseProb = 0;

  if (priority === 'high') baseProb = Math.min(100, baseProb + 10);
  if (priority === 'low') baseProb = Math.max(5, baseProb - 10);

  const firstName = (customer.name || 'Cliente').split(' ')[0];
  const company = customer.company || 'sua empresa';

  return {
    probability: baseProb,
    summary: `A oportunidade com ${customer.name || 'o contato'} da ${company} possui ticket de ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val)}. O lead encontra-se atualmente no estágio "${getStageLabel(stage)}" com prioridade ${priority.toUpperCase()}. Há forte potencial de geração de valor mútuo e expansão no segmento.`,
    keyPoints: [
      `Ticket no valor de ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val)} compatível com o perfil corporativo.`,
      `Decisor com cargo de ${customer.role || 'Liderança'}, com autonomia de escolha técnica e orçamentária.`,
      `Alinhamento estratégico com as tags: ${(customer.tags && customer.tags.length > 0) ? customer.tags.join(', ') : 'Tecnologia e Eficiência'}.`
    ],
    objections: [
      "Prazo de implementação: apresentar cronograma ágil com primeiros resultados em menos de 30 dias.",
      "Justificativa de ROI: demonstrar ganhos de produtividade e redução de custos operacionais logo no primeiro trimestre."
    ],
    recommendedAction: stage === 'won' 
      ? 'Agendar reunião de kick-off de onboarding para garantir rápida ativação.'
      : stage === 'proposal'
      ? 'Fazer follow-up com o decisor em até 48 horas oferecendo tirar dúvidas sobre o escopo.'
      : 'Apresentar demonstração prática e casos de sucesso similares para avançar para a fase de proposta.',
    proposalEmail: `Assunto: Proposta Estratégica Nexus para a ${company}\n\nOlá, ${firstName}!\n\nFoi um prazer conversar com você sobre as metas e desafios da ${company}. Conforme alinhamos, elaborei nossa proposta personalizada com foco em acelerar a sua operação com a máxima confiabilidade e segurança em nuvem do Google.\n\nFico à total disposição para alinharmos os detalhes e tirarmos qualquer dúvida.\n\nVocê tem 15 minutos amanhã às 14h para conversarmos rapidamente?\n\nUm abraço,\nEquipe Comercial Nexus CRM`
  };
}

function getStageLabel(stage) {
  const map = {
    lead: 'Novo Lead',
    contact: 'Primeiro Contato',
    proposal: 'Proposta Enviada',
    negotiation: 'Em Negociação',
    won: 'Fechado Ganho',
    lost: 'Perdido'
  };
  return map[stage] || stage;
}
