-- Enable Supabase Realtime for dgr_submissions so postgres_changes events fire
ALTER PUBLICATION supabase_realtime ADD TABLE dgr_submissions;
