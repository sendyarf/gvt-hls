const HLS_ORIGIN_DOMAINS = [
  "pl20.chinefore.com",
  "pl10.chinefore.com",
  "pl22.chinefore.com",
  "pl23.chinefore.com",
  "pl24.chinefore.com",
  "pl25.chinefore.com"
];

const VALID_REFERER = "https://play.957001.tv/";
const VALID_ORIGIN = "https://play.957001.tv";

const ALLOWED_DOMAINS = [
  "957001.tv",
  "play.957001.tv",
  "librani.govoet.my.id",
  "hls.govoet.my.id",
  "kilatpink.blogspot.com",
  "librani0.blogspot.com",
  "list-govoet.blogspot.com"
];

export default async function handler(request) {
  const url = new URL(request.url);

  // --- DOMAIN DETECTION ---
  let targetDomain = null;
  const domainParam = url.searchParams.get('domain');
  if (domainParam && HLS_ORIGIN_DOMAINS.includes(domainParam)) {
    targetDomain = domainParam;
  } else {
    targetDomain = url.pathname.includes('/live/') 
      ? "pl20.chinefore.com" 
      : HLS_ORIGIN_DOMAINS[0];
  }

  // --- DOMAIN RESTRICTION CHECK ---
  const referer = request.headers.get("Referer");
  const origin = request.headers.get("Origin");

  const isAllowedDomain = (urlString) => {
    if (!urlString) return false;
    try {
      const domain = new URL(urlString).hostname;
      return ALLOWED_DOMAINS.some(allowedDomain => 
        domain === allowedDomain || domain.endsWith('.' + allowedDomain)
      );
    } catch {
      return false;
    }
  };

  const validReferer = isAllowedDomain(referer);
  const validOrigin = isAllowedDomain(origin);

  if (!validReferer && !validOrigin) {
    return new Response("Access denied: Domain not authorized", {
      status: 403,
      headers: {
        'Content-Type': 'text/plain',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  const corsOrigin = (validOrigin && origin) ? origin : 
                    (validReferer && referer) ? new URL(referer).origin : 
                    'null';

  // Handle preflight CORS request
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': corsOrigin,
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, User-Agent, If-Modified-Since, Cache-Control, Range, If-None-Match',
        'Access-Control-Max-Age': '86400',
        'Vary': 'Origin'
      }
    });
  }

  // --- BUILD ORIGIN REQUEST ---
  const originUrl = `https://${targetDomain}${url.pathname}${url.search}`;

  const requestHeaders = new Headers();
  requestHeaders.set("Host", targetDomain);
  requestHeaders.set("Accept", "*/*");
  requestHeaders.set("Accept-Encoding", "gzip, deflate, br, zstd");
  requestHeaders.set("Accept-Language", "en-US,en;q=0.9,id;q=0.8");
  requestHeaders.set("Connection", "keep-alive");
  requestHeaders.set("Origin", VALID_ORIGIN);
  requestHeaders.set("Referer", VALID_REFERER);
  requestHeaders.set("Sec-CH-UA", '"Not)A;Brand";v="8", "Chromium";v="138", "Microsoft Edge";v="138"');
  requestHeaders.set("Sec-CH-UA-Mobile", "?0");
  requestHeaders.set("Sec-CH-UA-Platform", '"Windows"');
  requestHeaders.set("Sec-Fetch-Dest", "empty");
  requestHeaders.set("Sec-Fetch-Mode", "cors");
  requestHeaders.set("Sec-Fetch-Site", "cross-site");
  requestHeaders.set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 Edg/138.0.0.0");

  if (request.headers.get("If-Modified-Since")) {
    requestHeaders.set("If-Modified-Since", request.headers.get("If-Modified-Since"));
  }
  if (request.headers.get("If-None-Match")) {
    requestHeaders.set("If-None-Match", request.headers.get("If-None-Match"));
  }
  if (request.headers.get("Range")) {
    requestHeaders.set("Range", request.headers.get("Range"));
  }
  if (request.headers.get("Cache-Control")) {
    requestHeaders.set("Cache-Control", request.headers.get("Cache-Control"));
  }

  const originRequest = new Request(originUrl, {
    method: request.method,
    headers: requestHeaders,
    redirect: 'follow'
  });

  try {
    const originResponse = await fetch(originRequest);

    if (!originResponse.ok) {
      const errorText = await originResponse.text();
      return new Response(errorText, {
        status: originResponse.status,
        statusText: originResponse.statusText,
        headers: {
          'Access-Control-Allow-Origin': corsOrigin,
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Content-Type': originResponse.headers.get('Content-Type') || 'text/plain',
          'Vary': 'Origin'
        }
      });
    }

    const responseHeaders = new Headers();
    for (const [key, value] of originResponse.headers) {
      const lowerKey = key.toLowerCase();
      if (!lowerKey.startsWith('cf-') && 
          !lowerKey.startsWith('x-') && 
          lowerKey !== 'server' &&
          lowerKey !== 'via' &&
          lowerKey !== 'eagleid' &&
          lowerKey !== 'x-cache' &&
          lowerKey !== 'x-swift-cachetime' &&
          lowerKey !== 'x-swift-savetime' &&
          lowerKey !== 'x-tengine-type') {
        responseHeaders.set(key, value);
      }
    }

    responseHeaders.set("Access-Control-Allow-Origin", corsOrigin);
    responseHeaders.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    responseHeaders.set("Access-Control-Allow-Headers", "Content-Type, User-Agent, If-Modified-Since, Cache-Control, Range, If-None-Match");
    responseHeaders.set("Access-Control-Expose-Headers", "Date, Content-Type, Content-Length, Cache-Control, Expires, Last-Modified, ETag");
    responseHeaders.set("Vary", "Origin");
    responseHeaders.set("Timing-Allow-Origin", "*");

    const contentType = originResponse.headers.get("Content-Type") || "";

    if (contentType.includes("mpegurl") || 
        contentType.includes("m3u8") || 
        contentType.includes("application/x-mpegURL") ||
        url.pathname.includes('.m3u8')) {
      const originalText = await originResponse.text();
      const modifiedText = originalText.replace(
        /^(?!#)(?!https?:\/\/)(.+)$/gm, 
        (match, path) => {
          const trimmedPath = path.trim();
          if (!trimmedPath || trimmedPath.startsWith('http')) {
            return match;
          }
          if (trimmedPath.includes('.ts') || 
              trimmedPath.includes('.m4s') || 
              trimmedPath.includes('.m3u8') ||
              trimmedPath.includes('.mp4')) {
            const queryString = url.search;
            if (trimmedPath.startsWith('/')) {
              return `https://${url.hostname}${trimmedPath}${queryString}`;
            } else {
              const basePath = url.pathname.substring(0, url.pathname.lastIndexOf('/') + 1);
              return `https://${url.hostname}${basePath}${trimmedPath}${queryString}`;
            }
          }
          return match;
        }
      );

      return new Response(modifiedText, {
        status: originResponse.status,
        headers: responseHeaders
      });
    } else {
      return new Response(originResponse.body, {
        status: originResponse.status,
        headers: responseHeaders
      });
    }
  } catch (error) {
    return new Response(`Proxy Error: ${error.message}`, { 
      status: 502,
      headers: {
        'Access-Control-Allow-Origin': corsOrigin,
        'Content-Type': 'text/plain',
        'Vary': 'Origin'
      }
    });
  }
}

export const config = {
  runtime: 'edge'
};