export interface UpworkJob {
  job_id: string;
  title: string;
  url: string;
  description: string;
  budget: string;
  pub_date: string;
  score: number;
}

export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'submitted' | 'won' | 'lost';
export type OfferType = 'audit_build' | 'social_growth';

export interface UpworkProposal {
  id?: string;
  job_id: string;
  job_title: string;
  job_url: string;
  job_description?: string;
  budget?: string;
  score: number;
  proposal_text?: string;
  status: ProposalStatus;
  offer_type?: OfferType;
  telegram_message_id?: number;
  submitted_at?: string;
  created_at?: string;
  updated_at?: string;
}

export interface ProposalStats {
  pending: number;
  approved: number;
  rejected: number;
  submitted: number;
  won: number;
}

export interface ScanSummary {
  jobs_found: number;
  above_threshold: number;
  proposals_generated: number;
  errors: string[];
}
