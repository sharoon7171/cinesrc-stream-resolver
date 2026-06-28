export const SITE_ORIGIN = 'https://cinesrc.st'

export const CLIENT_HEADERS = {
  Accept: 'text/x-component',
  'Accept-Language': 'en-GB,en-US;q=0.9,en;q=0.8',
  'Content-Type': 'text/plain;charset=UTF-8',
  Origin: SITE_ORIGIN,
  Referer: `${SITE_ORIGIN}/`,
  'User-Agent':
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36',
  'sec-ch-ua': '"Chromium";v="137", "Not/A)Brand";v="24"',
  'sec-ch-ua-mobile': '?1',
  'sec-ch-ua-platform': '"Android"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin',
}

function parseAcceptLanguages(header) {
  return header.split(',').map((part) => part.split(';')[0].trim())
}

export const BROWSER_PROFILE = {
  platform: 'Linux armv81',
  hardwareConcurrency: 8,
  cookieEnabled: true,
  screenWidth: 360,
  screenHeight: 806,
  colorDepth: 24,
  devicePixelRatio: 2,
  languages: parseAcceptLanguages(CLIENT_HEADERS['Accept-Language']),
}

export function buildActionHeaders(actionId, route) {
  return {
    ...CLIENT_HEADERS,
    'Next-Action': actionId,
    'Next-Router-State-Tree': route.routeTree,
  }
}
