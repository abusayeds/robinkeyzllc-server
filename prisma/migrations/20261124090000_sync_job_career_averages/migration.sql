-- A career walk is its own job, so its runs can be told apart from the
-- single-season pull in the sync history.
ALTER TYPE "SyncJob" ADD VALUE 'careerAverages';
