// api/proxy.js
/**
 * =================================================================================
 * HLS Proxy Vercel Function untuk 957001.tv
 * =================================================================================
 * 
 * Target: pl20.chinefore.com dan domain serupa
 * Website: www.957001.tv / play.957001.tv
 */

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
    // Tambahkan domain Anda sendiri di sini
    "hls.govoet.my.id",
    "kilatpink.blogspot.com",
    "librani0.blogspot.com",
    "list-govoet.blogspot.com"
  ];
  
  export default async function handler(req, res) {
    const { method, url, headers, query } = req;
    const requestUrl = new URL(url, `https://${req.headers.host}`);
    
    // Handle path parameter dari rewrite rule
    const pathParam = query.path;
    if (pathParam) {
      // Reconstruct URL dengan path parameter
      const decodedPath = decodeURIComponent(pathParam);
      requestUrl.pathname = '/' + decodedPath;
    }
    
    // --- DOMAIN DETECTION ---
    let targetDomain = null;
    
    // Method 1: Gunakan query parameter untuk specify domain
    const domainParam = requestUrl.searchParams.get('domain');
    if (domainParam && HLS_ORIGIN_DOMAINS.includes(domainParam)) {
      targetDomain = domainParam;
    }
    
    // Method 2: Auto-detect berdasarkan path atau default
    if (!targetDomain) {
      // Auto-detect berdasarkan pattern di path atau gunakan default
      if (requestUrl.pathname.includes('/live/')) {
        targetDomain = "pl20.chinefore.com"; // Default untuk live streams
      } else {
        targetDomain = HLS_ORIGIN_DOMAINS[0]; // Default ke domain pertama
      }
    }
    
    // --- DOMAIN RESTRICTION CHECK ---
    const referer = headers.referer;
    const origin = headers.origin;
    
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
      return res.status(403).json({
        error: "Access denied: Domain not authorized"
      });
    }
    
    // Determine CORS origin untuk response
    const corsOrigin = (validOrigin && origin) ? origin : 
                      (validReferer && referer) ? new URL(referer).origin : 
                      '*';
    
    // Handle preflight CORS request
    if (method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Origin', corsOrigin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, User-Agent, If-Modified-Since, Cache-Control, Range, If-None-Match');
      res.setHeader('Access-Control-Max-Age', '86400');
      res.setHeader('Vary', 'Origin');
      return res.status(200).end();
    }
  
    // --- BUILD ORIGIN REQUEST ---
    const originUrl = `https://${targetDomain}${requestUrl.pathname}${requestUrl.search}`;
    
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
    if (headers["if-modified-since"]) {
      requestHeaders["If-Modified-Since"] = headers["if-modified-since"];
    }
    
    if (headers["if-none-match"]) {
      requestHeaders["If-None-Match"] = headers["if-none-match"];
    }
    
    if (headers["range"]) {
      requestHeaders["Range"] = headers["range"];
    }
    
    if (headers["cache-control"]) {
      requestHeaders["Cache-Control"] = headers["cache-control"];
    }
  
    try {
      const originResponse = await fetch(originUrl, {
        method: method,
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
        
        res.setHeader('Access-Control-Allow-Origin', corsOrigin);
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        res.setHeader('Content-Type', originResponse.headers.get('Content-Type') || 'text/plain');
        res.setHeader('Vary', 'Origin');
        
        return res.status(originResponse.status).send(errorText);
      }
  
      // Setup response headers
      const responseHeaders = {};
      
      // Copy headers dari response asli, skip yang tidak perlu
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
      
      // Set response headers
      Object.entries(responseHeaders).forEach(([key, value]) => {
        res.setHeader(key, value);
      });
      
      const contentType = originResponse.headers.get("Content-Type") || "";
      
      // Handle HLS playlist files
      if (contentType.includes("mpegurl") || 
          contentType.includes("m3u8") || 
          contentType.includes("application/x-mpegURL") ||
          requestUrl.pathname.includes('.m3u8')) {
        
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
              const queryString = requestUrl.search;
              
              if (trimmedPath.startsWith('/')) {
                // Absolute path
                return `https://${req.headers.host}/api/proxy${trimmedPath}${queryString}`;
              } else {
                // Relative path
                const basePath = requestUrl.pathname.substring(0, requestUrl.pathname.lastIndexOf('/') + 1);
                return `https://${req.headers.host}/api/proxy${basePath}${trimmedPath}${queryString}`;
              }
            }
            
            return match;
          }
        );
        
        console.log("Modified content length:", modifiedText.length);
        
        return res.status(originResponse.status).send(modifiedText);
      } else {
        // Handle media segments dan file lainnya
        const arrayBuffer = await originResponse.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        
        return res.status(originResponse.status).send(buffer);
      }
      
    } catch (error) {
      console.error("Vercel Function Error:", error);
      console.error("Failed URL:", originUrl);
      
      res.setHeader('Access-Control-Allow-Origin', corsOrigin);
      res.setHeader('Content-Type', 'text/plain');
      res.setHeader('Vary', 'Origin');
      
      return res.status(502).send(`Proxy Error: ${error.message}`);
    }
  }