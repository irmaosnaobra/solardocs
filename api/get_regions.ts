import { supabase } from './src/utils/supabase';

async function run() {
  const { data: rejected } = await supabase
    .from('quiz_events')
    .select('session_id')
    .eq('event_type', 'rejected_region')
    .eq('source', 'simulador');

  if (!rejected || rejected.length === 0) {
    console.log("No rejected_region found.");
    return;
  }

  const sessionIds = rejected.map((r: any) => r.session_id);

  const { data: details } = await supabase
    .from('quiz_events')
    .select('session_id, ip')
    .in('session_id', sessionIds)
    .not('ip', 'is', 'null');

  const ips = [...new Set(details?.map(d => d.ip).filter(Boolean))];

  console.log(`Encontrados ${ips.length} IPs únicos para as sessões rejeitadas.`);

  const regions: string[] = [];
  
  for (const ip of ips) {
      if (ip === "::1" || ip === "127.0.0.1" || ip === undefined) continue;
      
      try {
          const cleanIp = String(ip).split(',')[0].trim();
          const res = await fetch(`http://ip-api.com/json/${cleanIp}`);
          const geo: any = await res.json();
          if (geo && geo.status === 'success') {
              regions.push(`${geo.city} - ${geo.regionName} (${geo.country})`);
              console.log(`IP ${cleanIp}: ${geo.city} - ${geo.regionName}`);
          } else {
              console.log(`IP ${cleanIp}: Location not found`);
          }
      } catch(e: any) {
          console.log(`Erro ao buscar IP ${ip}`, e.message);
      }
  }

  console.log("\nRegions based on IP:");
  console.log(regions);
}

run();
