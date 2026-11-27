import { cleanupAllE2EData } from "./helpers/supabase-auth";

export default async function globalTeardown() {
  await cleanupAllE2EData({ deleteUsers: true });
}
