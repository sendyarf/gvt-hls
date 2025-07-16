export default async function handler(request) {
  return new Response("Test Edge Function", {
    status: 200,
    headers: { "Content-Type": "text/plain" }
  });
}

export const config = {
  runtime: "edge"
};