/*
 * Seed portfolio, derived from the Finance project list in the source dashboard.
 * All statuses were "Active" in the source; mapped to "in-progress".
 * No dates existed in the source, so every project starts as Unscheduled.
 */
export const SEED = {
  version: 1,
  updatedAt: null,
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
        stakeholders: '',
        updateSummary: '',
        description: '',
        milestones: [],
        comments: []
      }))
    }
  ]
};
