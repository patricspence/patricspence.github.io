const fs = require('fs');

const API_KEY = process.env.WU_API_KEY;
const stations = ['KFLOVIED224', 'KMIMOUNT110'];

if (!API_KEY) {
  console.error('WU_API_KEY is not set.');
  process.exit(1);
}

async function fetchStation(stationId) {
  const url =
    'https://api.weather.com/v2/pws/observations/current' +
    '?stationId=' + encodeURIComponent(stationId) +
    '&format=json' +
    '&units=e' +
    '&apiKey=' + encodeURIComponent(API_KEY);

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Weather API failed for ${stationId}: ${response.status}`);

  const data = await response.json();
  if (!data.observations || !data.observations.length) throw new Error(`No observations returned for ${stationId}`);
  return data.observations[0];
}

async function main() {
  const output = {
    updatedAt: new Date().toISOString(),
    observations: {}
  };

  for (const stationId of stations) {
    try {
      output.observations[stationId] = await fetchStation(stationId);
    } catch (error) {
      console.error(error.message);
      output.observations[stationId] = null;
    }
  }

  fs.writeFileSync('weather/weather-data.json', JSON.stringify(output, null, 2));
  console.log('weather/weather-data.json updated.');
}

main();
