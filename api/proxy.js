const fetch = require('node-fetch');

// HLS origin domains untuk 957001.tv
const HLS_ORIGIN_DOMAINS = [
  "pl20.chinefore.com",
  "pl10.chinefore.com",
  "pl22.chinefore.com",
  "pl23.chinefore.com",
  "pl24.chinefore.com",
  "pl25.chinefore.com"
];

// Valid referer dan origin untuk 957001.tv
const VALID_REFERER = "https://play.957001.tv/";
const VALID_ORIGIN = "https://play.957001.tv";

// Whitelist domain yang diizinkan mengakses HLS
const ALLOWED_DOMAINS = [
  "957001.tv",
  "play.957001.tv",
  "librani.govoet.my.id",
  "hls.govoet.my.id",
  "kilatpink.blogspot.com",
  "librani0.blogspot.com",
  "list-govoet.blogspot.com"
];

export default async function handler(req, res) {
  const url = new URL(req.url, `https://${req.headers.host}`);
  
  // --- DOMAIN DETECTION ---
  let targetDomain = null;
  
  // Method 1: Gunakan query parameter untuk specify domain
  const domainParam = url.searchParams.get('domain');
  if (domainParam && HLS_ORIGIN_DOMAINS.includes(domainParam)) {
    targetDomain = domainParam;
  }
  
  // Method 2: Auto-detect berdasarkan path atau default
  if (!targetDomain) {
    if (url.pathname.includes('/live/')) {
      targetDomain = "pl20.chinefore.com"; // Default untuk live streams
    } else {
      targetDomain = HLS_ORIGIN_DOMAINS[0]; // Default ke domain pertama
    }
  }
  
  // --- DOMAIN RESTRICTION CHECK ---
  const referer = req.headers.referer || req.headers.referrer;
  const origin = req.headers.origin;
  
  // Function untuk check domain
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
  
  // Validasi domain - harus ada salah satu dari referer atau origin yang valid
  const validReferer = isAllowedDomain(referer);
  const validOrigin = isAllowedDomain(origin);
  
  if (!validReferer && !validOrigin) {
    res.status(403).setHeader('Content-Type', 'text/plain');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.end("Access denied: Domain not authorized");
  }
  
  // Determine CORS origin untuk response
  const corsOrigin = (validOrigin && origin) ? origin : 
                    (validReferer && referer) ? new URL(referer).origin : 
                    'null';
  
  // Handle preflight CORS request
  if (req.method === 'OPTIONS') {
    res.status(200);
    res.setHeader('Access-Control-Allow-Origin', corsOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, User-Agent, If-Modified-Since, Cache-Control, Range, If-None-Match');
    res.setHeader('Access-Control-Max-Age', '86400');
    res.setHeader('Vary', 'Origin');
    return res.end();
  }

  // --- BUILD ORIGIN REQUEST ---
  const originUrl = `https://${targetDomain}${url.pathname}${url.search}`;
  
  // --- SETUP HEADERS BERDASARKAN REQUEST 957001.TV ---
  const requestHeaders = {
    "Host": targetDomain,
    "Accept": "*/*",
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "Accept-Language": "en-US,en;q=0.9,id;q=0.8",
    "Connection": "keep-alive",
    "Origin": VALID_ORIGIN,
    "Referer": VALID_REFERER,
    "Sec-CH-UA": '"Not)A;Brand";v="8", "Chromium";v="138", "Microsoft Edge";v="138"',
    "Sec-CH-UA-Mobile": "?0",
    "Sec-CH-UA-Platform": '"Windows"',
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "cross-site",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 Edg/138.0.0.0"
  };
  
  // Copy conditional headers jika ada
  if (req.headers['if-modified-since']) {
    requestHeaders["If-Modified-Since"] = req.headers['if-modified-since'];
  }
  
  if (req.headers['if-none-match']) {
    requestHeaders["If-None-Match"] = req.headers['if-none-match'];
  }
  
  if (req.headers.range) {
    requestHeaders["Range"] = req.headers.range;
  }
  
  if (req.headers['cache-control']) {
    requestHeaders["Cache-Control"] = req.headers['cache-control'];
  }

  try {
    const originResponse = await fetch(originUrl, {
      method: req.method,
      headers: requestHeaders,
      redirect: 'follow'
    });
    
    // Log untuk debugging
    console.log(`Request to: ${originUrl}`);
    console.log(`Response status: ${originResponse.status}`);
    
    // Jika server menolak, return response asli dengan CORS
    if (!originResponse.ok) {
      const errorText = await originResponse.text();
      console.log(`Error response: ${errorText}`);
      
      res.status(originResponse.status);
      res.setHeader('Content-Type', originResponse.headers.get('Content-Type') || 'text/plain');
      res.setHeader('Access-Control-Allow-Origin', corsOrigin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.setHeader('Vary', 'Origin');
      return res.end(errorText);
    }

    // Setup response headers
    const responseHeaders = {};
    
    // Copy headers dari response asli, skip yang tidak perlu
    for (const [key, value] of originResponse.headers.entries()) {
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
        responseHeaders[key] = value;
      }
    }
    
    // Set CORS headers
    responseHeaders["Access-Control-Allow-Origin"] = corsOrigin;
    responseHeaders["Access-Control-Allow-Methods"] = "GET, HEAD, OPTIONS";
    responseHeaders["Access-Control-Allow-Headers"] = "Content-Type, User-Agent, If-Modified-Since, Cache-Control, Range, If-None-Match";
    responseHeaders["Access-Control-Expose-Headers"] = "Date, Content-Type, Content-Length, Cache-Control, Expires, Last-Modified, ETag";
    responseHeaders["Vary"] = "Origin";
    responseHeaders["Timing-Allow-Origin"] = "*";
    
    const contentType = originResponse.headers.get("Content-Type") || "";
    
    // Handle HLS playlist files
    if (contentType.includes("mpegurl") || 
        contentType.includes("m3u8") || 
        contentType.includes("application/x-mpegURL") ||
        url.pathname.includes('.m3u8')) {
      
      const originalText = await originResponse.text();
      
      console.log("Processing HLS playlist for 957001.tv");
      console.log("Original content length:", originalText.length);
      console.log("Content preview:", originalText.substring(0, 200));
      
      // Modify URLs dalam playlist
      const modifiedText = originalText.replace(
        /^(?!#)(?!https?:\/\/)(.+)$/gm, 
        (match, path) => {
          const trimmedPath = path.trim();
          
          // Skip empty lines atau yang sudah absolute URL
          if (!trimmedPath || trimmedPath.startsWith('http')) {
            return match;
          }
          
          // Handle media segments (.ts, .m4s, .m3u8)
          if (trimmedPath.includes('.ts') || 
              trimmedPath.includes('.m4s') || 
              trimmedPath.includes('.m3u8') ||
              trimmedPath.includes('.mp4')) {
            
            // Preserve semua query parameters
            const queryString = url.search;
            
            if (trimmedPath.startsWith('/')) {
              // Absolute path
              return `https://${url.hostname}${trimmedPath}${queryString}`;
            } else {
              // Relative path
              const basePath = url.pathname.substring(0, url.pathname.lastIndexOf('/') + 1);
              return `https://${url.hostname}${basePath}${trimmedPath}${queryString}`;
            }
          }
          
          return match;
        }
      );
      
      console.log("Modified content length:", modifiedText.length);
      
      // Set response headers
      Object.entries(responseHeaders).forEach(([key, value]) => {
        res.setHeader(key, value);
      });
      
      res.status(originResponse.status);
      return res.end(modifiedText);
    } else {
      // Handle media segments dan file lainnya
      Object.entries(responseHeaders).forEach(([key, value]) => {
        res.setHeader(key, value);
      });
      
      res.status(originResponse.status);
      // Pipe the response body directly
      const buffer = await originResponse.buffer();
      return res.end(buffer);
    }
    
  } catch (error) {
    console.error("Vercel Error:", error);
    console.error("Failed URL:", originUrl);
    
    res.status(502);
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Access-Control-Allow-Origin', corsOrigin);
    res.setHeader('Vary', 'Origin');
    return res.end(`Proxy Error: ${error.message}`);
  }
}