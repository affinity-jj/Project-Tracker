/*
 * Seed portfolio, derived from the Finance project list in the source dashboard.
 * All statuses were "Active" in the source; mapped to "in-progress".
 * No dates existed in the source, so every project starts as Unscheduled.
 */
export const SEED = {
  version: 1,
  updatedAt: null,
  roiDrivers: [
    { id: 'roi-cost',         name: 'Cost Reduction',            color: '#e0a458' },
    { id: 'roi-revenue',      name: 'Revenue Growth',            color: '#5eead4' },
    { id: 'roi-productivity', name: 'Productivity / Efficiency', color: '#c4b5fd' },
    { id: 'roi-risk',         name: 'Risk & Compliance',         color: '#fca5a5' },
    { id: 'roi-experience',   name: 'Customer Experience',       color: '#93c5fd' },
    { id: 'roi-quality',      name: 'Quality / Accuracy',        color: '#fcd34d' }
  ],
  categories: [
    {
      id: 'cat-finance',
      name: 'Finance',
      projects: [
        'QCD Review',
        'Foreclosure MR Review',
        'Mortgage Modification',
        'Mortgage Payment',
        'Deeded Recording Transcription',
        'Resort Compliance',
        'Resort Accounting Utility Bills'
      ].map((name, i) => ({
        id: 'fin-' + (i + 1),
        name,
        status: 'in-progress',
        startDate: '',
        endDate: '',
        team: '',
        roiPrimary: '',
        roiSecondary: [],
        stakeholders: '',
        updateSummary: '',
        description: '',
        milestones: [],
        comments: []
      }))
    }
  ]
};
