export const TARGET = 'https://cinesrc.st'

export const SPOOF_HEADERS = {
  Accept: 'text/x-component',
  'Accept-Language': 'en-GB,en-US;q=0.9,en;q=0.8',
  'Content-Type': 'text/plain;charset=UTF-8',
  Origin: TARGET,
  Referer: `${TARGET}/`,
  'User-Agent':
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36',
  'sec-ch-ua': '"Chromium";v="137", "Not/A)Brand";v="24"',
  'sec-ch-ua-mobile': '?1',
  'sec-ch-ua-platform': '"Android"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin',
}

export function forgeActionHeaders(actionId, route) {
  return {
    ...SPOOF_HEADERS,
    'Next-Action': actionId,
    'Next-Router-State-Tree': route.routeTree,
  }
}

export const TOKEN_MANIFEST =
  'https://script.google.com/macros/s/AKfycbw_Q_5IHAiAmEABUh0QiqDUGzrHtTwkmbZcWhXM3ixH4IiukUK5wfDTQ5Sjj6EPwbRd/exec'
