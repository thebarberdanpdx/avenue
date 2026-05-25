import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://iufgznminbujcabqeesk.supabase.co'
const supabaseKey = 'sb_publishable_aGX3akW7VfHO6Lm-FsZmEA_sf95Nu2i'

export const supabase = createClient(supabaseUrl, supabaseKey)