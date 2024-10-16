export default async (url: string) => {
  const res = await fetch(url);
  const content = await res.text();

  if (!res.ok) {
    console.error(`failed fetching ${url} - ${res.status} ${res.statusText}: ${content}`);

    return {
      success: false as const,
    };
  }

  return {
    success: true as const,
    content,
  };
};
