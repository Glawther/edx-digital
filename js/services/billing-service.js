/**
 * Nexus CRM - Plans
 * The single source for plan names, prices and limits shown in the app.
 * Keep it in step with the plans section of landing.html.
 */

export const PLANS = {
  starter: {
    id: 'starter',
    name: 'Starter',
    badge: 'Iniciante',
    priceMonthly: 97,
    priceYearly: 931,
    maxLeads: 500,
    maxUsers: 2,
    aiQuotaMonth: 30,
    features: [
      'Até 500 leads ativos',
      '2 vendedores / consultores',
      '30 análises de IA (Gemini Flash)/mês',
      'Kanban comercial drag & drop',
      'Backup e exportação CSV'
    ]
  },
  pro: {
    id: 'pro',
    name: 'Professional',
    badge: 'Mais Popular',
    priceMonthly: 197,
    priceYearly: 1891,
    maxLeads: 5000,
    maxUsers: 10,
    aiQuotaMonth: 150,
    features: [
      'Até 5.000 leads ativos',
      '10 membros da equipe com papéis',
      '150 análises de IA/mês',
      'Customização Whitelabel completa',
      'Sincronização Cloud Firestore',
      'Notificações Push no navegador'
    ]
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    badge: 'Corporativo',
    priceMonthly: 497,
    priceYearly: 4771,
    maxLeads: 999999,
    maxUsers: 999,
    aiQuotaMonth: 9999,
    features: [
      'Leads ilimitados',
      'Equipe e consultores ilimitados',
      'Cota de IA ilimitada (Gemini BYOK)',
      'Histórico de auditoria',
      'Multi-tenant com isolamento total',
      'Suporte prioritário VIP 24/7'
    ]
  }
};
