// localStorage는 막혀 있을 수 있으므로 항상 try/catch
function get(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function set(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export const store = {
  name: () => get('el:name') ?? '',
  setName: (n: string) => set('el:name', n),
  token: (code: string) => get(`el:token:${code}`),
  setToken: (code: string, t: string | null) => set(`el:token:${code}`, t),
  password: (code: string) => get(`el:pw:${code}`),
  setPassword: (code: string, pw: string | null) => set(`el:pw:${code}`, pw),
};
