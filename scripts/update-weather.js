const fs = require('node:fs');
const path = require('node:path');

const API_KEY = process.env.WU_API_KEY;
const stations = ['KFLOVIED224', 'KMIMOUNT110'];
const outputPath = path.join('weather', 'weather-data.json');
const MAX_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 15000;

if (!API_KEY) {
  console.error('ERROR: WU_API_KEY is not set.');
  process.exit(1);
}

function readPreviousData() {
  try {
    return JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('Previous weather data could not be read:', error.message);
    }
    return { observations: {} };
  }
}

// Publish only readings used by the dashboard, not station coordinates.
function publicObservation(obs) {
  const imperial = obs.imperial || {};
  return {
    stationID: obs.stationID,
    obsTimeUtc: obs.obsTimeUtc,
    epoch: obs.epoch,
    humidity: obs.humidity,
    winddir: obs.winddir,
    solarRadiation: obs.solarRadiation,
    uv: obs.uv,
    qcStatus: obs.qcStatus,
    imperial: {
      temp: imperial.temp,
      heatIndex: imperial.heatIndex,
      windChill: imperial.windChill,
      dewpt: imperial.dewpt,
      windSpeed: imperial.windSpeed,
      windGust: imperial.windGust,
      pressure: imperial.pressure,
      precipRate: imperial.precipRate,
      precipTotal: imperial.precipTotal
    }
  };
}

async function fetchStation(stationId) {
  const url = new URL('https://api.weather.com/v2/pws/observations/current');
  url.search = new URLSearchParams({
    stationId, format: 'json', units: 'e', apiKey: API_KEY
  }).toString();

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
      if (!response.ok) {
        // Never echo API error bodies or URLs containing the API key.
        throw new Error('HTTP ' + response.status);
      }

      const data = await response.json();
      const observation = data.observations?.find(
        (obs) => obs && obs.stationID === stationId
      );
      if (!observation) {
        throw new Error('No matching observation returned');
      }
      console.log('Success:', stationId);
      return publicObservation(observation);
    } catch (error) {
      if (attempt === MAX_ATTEMPTS) {
        throw new Error(stationId + ': ' + error.message);
      }
      console.warn(stationId + ': attempt ' + attempt + ' failed; retrying');
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
}

async function main() {
  const previous = readPreviousData();
  const output = {
    updatedAt: new Date().toISOString(),
    failedStations: [],
    observations: {}
  };

  let successCount = 0;
  for (const stationId of stations) {
    try {
      output.observations[stationId] = await fetchStation(stationId);
      successCount++;
    } catch (error) {
      console.error('ERROR:', error.message);
      output.failedStations.push(stationId);
      output.observations[stationId] =
        previous.observations?.[stationId] || null;
    }
  }

  if (successCount === 0) {
    // Do not overwrite useful observations (or change their timestamp)
    // when both API requests failed.
    console.error('ERROR: No stations updated; preserving previous JSON.');
    process.exitCode = 1;
    return;
  }

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n');
  console.log(
    'Updated ' + successCount + ' of ' + stations.length +
    ' stations; retained ' + output.failedStations.length + ' older readings.'
  );
}

main().catch((error) => {
  console.error('Fatal error:', error.message);
  process.exitCode = 1;
});
