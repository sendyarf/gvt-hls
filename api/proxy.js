/**
 * Vercel Edge Function untuk HLS Proxy
 */

// HLS origin domains
const HLS_ORIGIN_DOMAINS = [
    "pl20.chinefore.com",
    "pl10.chinefore.com",
    "pl22.chinefore.com",
    "pl23.chinefore.com",
    "pl24.chinefore.com",
    "pl25.chinefore.com"
  ];
  
  // Valid referer dan origin
  const VALID_REFERER = "https://play.957001.tv/";
  const VALID_ORIGIN = "https://play.957001.tv";
  
  // Whitelist domain yang diizinkan
  const ALLOWED_DOMAINS = [
    "957001.tv",
    "play.957001.tv",
    "librani.govoet.my.id",
    "hls.govoet.my.id",
    "kilatpink.blogspot.com",
    "librani0.blogspot.com",
    "list-govoet.blogspot.com",
    "localhost",
    "127.0.0.1"
  ];
  
  export default async function handler(request) {
    const url = new URL(request.url);
    
    // --- DOMAIN DETECTION ---
    let targetDomain = null;
    
    // Method 1: Query parameter
    const domainParam = url.searchParams.get('domain');
    if (domainParam && HLS_ORIGIN_DOMAINS.includes(domainParam)) {
      targetDomain = domainParam;
    }
    
    // Method 2: Header atau default
    if (!targetDomain) {
      const targetHeader = request.headers.get('X-Target-Domain');
      if (targetHeader && HLS_ORIGIN_DOMAINS.includes(targetHeader)) {
        targetDomain = targetHeader;
      } else {
        targetDomain = "pl20.chinefore.com"; // Default
      }
    }
    
    // --- PATH EXTRACTION ---
    // Extract path dari URL: /api/proxy/path/to/file.m3u8
    const pathMatch = url.pathname.match(/^\/api\/proxy\/(.*)$/);
    let targetPath = pathMatch ? pathMatch[1] : '';
    
    // Jika tidak ada path, coba dari query parameter
    if (!targetPath) {
      targetPath = url.searchParams.get('path') || '';
    }
    
    // --- DOMAIN VALIDATION ---
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
    
    // Skip validation untuk development
    const isDevelopment = url.hostname.includes('localhost') || 
                         url.hostname.includes('127.0.0.1') ||
                         url.hostname.includes('vercel.app') ||
                         url.hostname.includes('vercel.dev');
    
    if (!isDevelopment && !validReferer && !validOrigin) {
      return new Response("Access denied: Domain not authorized", {
        status: 403,
        headers: {
          'Content-Type': 'text/plain',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
    
    // CORS origin
    const corsOrigin = (validOrigin && origin) ? origin : 
                      (validReferer && referer) ? new URL(referer).origin : 
                      '*';
    
    // Handle preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 200,
        headers: {
          'Access-Control-Allow-Origin': corsOrigin,
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, User-Agent, Range, If-None-Match, X-Target-Domain',
          'Access-Control-Max-Age': '86400'
        }
      });
    }
    
    // --- BUILD TARGET URL ---
    const targetUrl = `https://${targetDomain}/${targetPath}${url.search}`;
    
    // --- SETUP HEADERS ---
    const requestHeaders = new Headers();
    requestHeaders.set("Host", targetDomain);
    requestHeaders.set("Accept", "*/*");
    requestHeaders.set("Accept-Encoding", "gzip, deflate, br");
    requestHeaders.set("Accept-Language", "en-US,en;q=0.9,id;q=0.8");
    requestHeaders.set("Connection", "keep-alive");
    requestHeaders.set("Origin", VALID_ORIGIN);
    requestHeaders.set("Referer", VALID_REFERER);
    requestHeaders.set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
    
    // Copy conditional headers
    ['If-Modified-Since', 'If-None-Match', 'Range', 'Cache-Control'].forEach(header => {
      const value = request.headers.get(header);
      if (value) requestHeaders.set(header, value);
    });
    
    try {
      const response = await fetch(targetUrl, {
        method: request.method,
        headers: requestHeaders
      });
      
      if (!response.ok) {
        return new Response(`Target server error: ${response.status}`, {
          status: response.status,
          headers: {
            'Access-Control-Allow-Origin': corsOrigin,
            'Content-Type': 'text/plain'
          }
        });
      }
      
      // Setup response headers
      const responseHeaders = new Headers();
      
      // Copy important headers
      ['Content-Type', 'Content-Length', 'Cache-Control', 'Expires', 'Last-Modified', 'ETag'].forEach(header => {
        const value = response.headers.get(header);
        if (value) responseHeaders.set(header, value);
      });
      
      // CORS headers
      responseHeaders.set("Access-Control-Allow-Origin", corsOrigin);
      responseHeaders.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
      responseHeaders.set("Access-Control-Expose-Headers", "Content-Length, Content-Type, Cache-Control, Expires, Last-Modified, ETag");
      
      const contentType = response.headers.get("Content-Type") || "";
      
      // Handle HLS playlist
      if (contentType.includes("mpegurl") || 
          contentType.includes("m3u8") || 
          targetPath.includes('.m3u8')) {
        
        const originalText = await response.text();
        
        // Modify URLs in playlist
        const modifiedText = originalText.replace(
          /^(?!#)(?!https?:\/\/)(.+)$/gm,
          (match, path) => {
            const trimmedPath = path.trim();
            
            if (!trimmedPath || trimmedPath.startsWith('http')) {
              return match;
            }
            
            // Build proxy URL
            const proxyBase = `https://${url.hostname}/api/proxy`;
            const queryParams = new URLSearchParams();
            queryParams.set('domain', targetDomain);
            
            if (trimmedPath.startsWith('/')) {
              return `${proxyBase}${trimmedPath}?${queryParams.toString()}`;
            } else {
              const basePath = targetPath.substring(0, targetPath.lastIndexOf('/') + 1);
              return `${proxyBase}/${basePath}${trimmedPath}?${queryParams.toString()}`;
            }
          }
        );
        
        return new Response(modifiedText, {
          status: response.status,
          headers: responseHeaders
        });
      }
      
      // Handle media files
      return new Response(response.body, {
        status: response.status,
        headers: responseHeaders
      });
      
    } catch (error) {
      return new Response(`Proxy Error: ${error.message}`, {
        status: 502,
        headers: {
          'Access-Control-Allow-Origin': corsOrigin,
          'Content-Type': 'text/plain'
        }
      });
    }
  }