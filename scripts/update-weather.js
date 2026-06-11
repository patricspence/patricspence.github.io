const fs = require('fs');
const path = require('path');

const API_KEY = process.env.WU_API_KEY;
const stations = ['KFLOVIED224', 'KMIMOUNT110'];
const outputPath = path.join('weather', 'weather-data.json');

if (!API_KEY) {
  console.error('ERROR: WU_API_KEY is not set.');
  process.exit(1);
}

async function fetchStation(stationId) {
  const url =
    'https://api.weather.com/v2/pws/observations/current' +
    '?stationId=' + encodeURIComponent(stationId) +
    '&format=json' +
    '&units=e' +
    '&apiKey=' + encodeURIComponent(API_KEY);

  console.log(`Fetching ${stationId}...`);

  const response = await fetch(url);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Weather API failed for ${stationId}: ${response.status} ${body}`);
  }

  const data = await response.json();

  if (!data.observations || !data.observations.length) {
    throw new Error(`No observations returned for ${stationId}`);
  }

  console.log(`Success: ${stationId}`);
  return data.observations[0];
}

async function main() {
  console.log('Starting weather update...');
  console.log(`Writing output to: ${outputPath}`);

  const output = {
    updatedAt: new Date().toISOString(),
    observations: {}
  };

  let successCount = 0;

  for (const stationId of stations) {
    try {
      output.observations[stationId] = await fetchStation(stationId);
      successCount++;
    } catch (error) {
      console.error(`ERROR for ${stationId}: ${error.message}`);
      output.observations[stationId] = null;
    }
  }

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n');

  console.log(`Weather update complete. ${successCount} of ${stations.length} stations updated.`);
  console.log(`Updated timestamp: ${output.updatedAt}`);

  if (successCount === 0) {
    console.error('ERROR: No stations updated. The JSON file was written, but all station data is null.');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
