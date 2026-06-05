export const ORIGIN = 'https://cinesrc.st'
export const USER_AGENT =
  'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36'

export const CINESRC_HEADERS = {
  Accept: 'text/x-component',
  'Accept-Language': 'en-GB,en-US;q=0.9,en;q=0.8',
  'Content-Type': 'text/plain;charset=UTF-8',
  Origin: ORIGIN,
  Referer: `${ORIGIN}/`,
  'User-Agent': USER_AGENT,
  'sec-ch-ua': '"Chromium";v="137", "Not/A)Brand";v="24"',
  'sec-ch-ua-mobile': '?1',
  'sec-ch-ua-platform': '"Android"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin',
}

export function buildActionHeaders(actionId, route) {
  return {
    ...CINESRC_HEADERS,
    'Next-Action': actionId,
    'Next-Router-State-Tree': route.routerStateTree,
  }
}

export const ACTIONS = {
  getProviderList: '007ba46e155cc9fce850715a780d73c1cf352dd28b',
  getStream: '7ebe49d609945f83f0107965c67e7eb0608611dfbd',
}

export const TOKEN_URL =
  'https://script.google.com/macros/s/AKfycbw_Q_5IHAiAmEABUh0QiqDUGzrHtTwkmbZcWhXM3ixH4IiukUK5wfDTQ5Sjj6EPwbRd/exec'
