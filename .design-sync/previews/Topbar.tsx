import { AuthContext, PanelsProvider, Topbar, ViewContext } from 'colwrite-ui';

// Topbar returns null while `user` is null, and the real AuthProvider only sets
// a user after confirming a cached identity against the server — unreachable in
// a static capture. So the auth and view contexts are supplied as literal
// values, the way a Storybook decorator would; PanelsProvider is the real one
// (it derives everything from matchMedia).

const noop = () => {};
const auth = {
  status: 'authenticated' as const,
  openAuth: noop,
  closeAuth: noop,
  logout: noop,
  loginWithCredentials: async () => {},
};

function Frame({
  children,
  view = 'workspace' as const,
  user,
}: {
  children?: React.ReactNode;
  view?: 'workspace' | 'profile';
  user: { name: string; email: string; userType?: string | null };
}) {
  return (
    <PanelsProvider>
      <AuthContext.Provider value={{ ...auth, user }}>
        <ViewContext.Provider value={{ view, setView: noop }}>
          <div className="w-full max-w-5xl">{children}</div>
        </ViewContext.Provider>
      </AuthContext.Provider>
    </PanelsProvider>
  );
}

export function SignedIn() {
  return (
    <Frame user={{ name: 'Andrés Lamos', email: 'a.lamos@institute.edu' }}>
      <Topbar />
    </Frame>
  );
}

export function EmailOnlyAccount() {
  return (
    <Frame user={{ name: '', email: 'r.okonkwo@lab.example' }}>
      <Topbar />
    </Frame>
  );
}

export function OnTheProfileView() {
  return (
    <Frame view="profile" user={{ name: 'Mei Watanabe', email: 'mei@arxiv-reader.org' }}>
      <Topbar />
    </Frame>
  );
}
