import { Component, type ReactNode } from 'react';
import { auth } from './firebase.ts';
import { postClientError } from './client-error.ts';

type Props = { children: ReactNode };
type State = { reference: string; requestId: string };

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { reference: '', requestId: '' };
  private mounted = true;
  private shownReference = '';

  static getDerivedStateFromError(): State {
    return { reference: crypto.randomUUID(), requestId: '' };
  }

  componentDidCatch(error: Error) {
    const reference = this.state.reference || this.shownReference || crypto.randomUUID();
    if (!this.state.reference) this.setState({ reference });
    void this.report(error, reference);
  }

  private async report(error: Error, reference: string) {
    let token: string | undefined;
    try {
      token = await auth.currentUser?.getIdToken();
    } catch {
      token = undefined;
    }
    const requestId = await postClientError(
      {
        reference,
        message: error.message,
        stack: error.stack,
        path: window.location.pathname,
      },
      { token },
    );
    if (this.mounted && requestId) this.setState({ requestId });
  }

  componentWillUnmount() {
    this.mounted = false;
  }

  render() {
    if (this.state.reference) this.shownReference = this.state.reference;
    if (!this.state.reference) return this.props.children;
    const reference = this.state.requestId || this.state.reference;
    return (
      <main className="crash">
        <section className="crash-card" role="alert">
          <h1>Something went wrong</h1>
          <p>Reload the page to continue. If this keeps happening, quote the reference below.</p>
          <p className="crash-reference">
            Reference <strong>{reference}</strong>
          </p>
          <button type="button" className="button primary" onClick={() => window.location.reload()}>
            Reload
          </button>
        </section>
      </main>
    );
  }
}
