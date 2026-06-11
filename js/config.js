const SB_URL = 'https://xxayufvjvxfyxgqepaov.supabase.co';
const SB_KEY = 'sb_publishable_SpckGJgWyFYcTr99HpRz7Q_PsbVHbQi';

const BADGE = {
  'Hunting New': 'b-hn',
  'Hunting New - Pre Approval': 'b-hnp',
  'Hunting New - Ratified': 'b-hnr',
  'Hunting New - Closing': 'b-hnc',
  'Hunting Rescued': 'b-hr',
  'Hunting Rescued - Pre Approval': 'b-hrp',
  'Hunting Rescued - Ratified': 'b-hrr',
  'Hunting Rescued - Closing': 'b-hrc',
  'Farming Lead': 'b-fl',
  'Farming Pre Approval': 'b-fp',
  'Farming Ratified': 'b-frat',
  'Farming Closing': 'b-fc',
  'Sin medición': 'b-sin',
  'Inactive': 'b-inactive'
};

let leadsData = null, oppData = null;
let activeResults = [], inactiveResults = [];
let masterMap = new Map();
let changeLog = [];
let currentMode = 'active', sortCol = 'cnt', sortDir = -1;
let dbConnected = false;
