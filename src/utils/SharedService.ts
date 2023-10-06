//https://github.com/rhashimoto/wa-sqlite/blob/master/demo/SharedService/SharedService.js
const PROVIDER_REQUEST_TIMEOUT: number = 1000;

type PromiseCallback<T> = {
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: any) => void;
};

export class SharedService extends EventTarget {
  #serviceName: string;
  #clientId: Promise<string>;
  #portProviderFunc: () => MessagePort | Promise<MessagePort>;

  // This BroadcastChannel is used for client messaging. The provider
  // must have a separate BroadcastChannel in case the instance is
  // both client and provider.
  #clientChannel: BroadcastChannel = new BroadcastChannel("SharedService");

  #onDeactivate?: AbortController | null = null;
  #onClose: AbortController = new AbortController();

  // This is client state to track the provider. The provider state is
  // mostly managed within activate().
  #providerPort: Promise<MessagePort | null>;
  providerCallbacks: Map<string, PromiseCallback<any>> = new Map();
  #providerCounter: number = 0;
  #providerChangeCleanup: (() => void)[] = [];

  proxy: Record<string, (...args: any[]) => Promise<any>>;

  constructor(
    serviceName: string,
    portProviderFunc: () => MessagePort | Promise<MessagePort>
  ) {
    super();

    console.log("SharedService constructor", portProviderFunc);
    this.#serviceName = serviceName;
    this.#portProviderFunc = portProviderFunc;

    this.#clientId = this.#getClientId();

    this.#providerPort = this.#providerChange();
    this.#clientChannel.addEventListener(
      "message",
      ({ data }) => {
        if (
          data?.type === "provider" &&
          data?.sharedService === this.#serviceName
        ) {
          // A context (possibly this one) announced itself as the new provider.
          // Discard any old provider and connect to the new one.
          this.#closeProviderPort(this.#providerPort);
          this.#providerPort = this.#providerChange();
        }
      },
      { signal: this.#onClose.signal }
    );

    this.proxy = this.#createProxy();
  }

  activate(callback: () => void): void {
    if (this.#onDeactivate) return;

    // When acquire a lock on the service name then we become the service
    // provider. Only one instance at a time will get the lock; the rest
    // will wait their turn.
    this.#onDeactivate = new AbortController();
    navigator.locks.request(
      `SharedService-${this.#serviceName}`,
      { signal: this.#onDeactivate.signal },
      async () => {
        // Get the port to request client ports.
        const port = await this.#portProviderFunc();
        port.start();

        // Listen for client requests. A separate BroadcastChannel
        // instance is necessary because we may be serving our own
        // request.
        const providerId = await this.#clientId;
        const broadcastChannel = new BroadcastChannel("SharedService");
        broadcastChannel.addEventListener(
          "message",
          async ({ data }) => {
            console.log("SharedService provider message", data);
            if (
              data?.type === "request" &&
              data?.sharedService === this.#serviceName
            ) {
              // Get a port to send to the client.
              const requestedPort = await new Promise<MessagePort>(
                (resolve) => {
                  port.addEventListener(
                    "message",
                    (event) => {
                      console.log("SharedService provider port message", event);
                      resolve(event.ports[0]);
                    },
                    { once: true }
                  );
                  port.postMessage(data.clientId);
                }
              );

              this.#sendPortToClient(data, requestedPort);
              callback();
            }
          },
          { signal: this.#onDeactivate?.signal }
        );

        // Tell everyone that we are the new provider.
        broadcastChannel.postMessage({
          type: "provider",
          sharedService: this.#serviceName,
          providerId,
        });

        // Release the lock only on user abort or context destruction.
        return new Promise((_, reject) => {
          this.#onDeactivate?.signal.addEventListener("abort", () => {
            broadcastChannel.close();
            reject(this.#onDeactivate?.signal.reason);
          });
        });
      }
    );
  }

  deactivate() {
    this.#onDeactivate?.abort();
    this.#onDeactivate = null;
  }

  close() {
    this.deactivate();
    this.#onClose.abort();
    for (const { reject } of this.providerCallbacks.values()) {
      reject(new Error("SharedService closed"));
    }
  }

  async #sendPortToClient(message: any, port: MessagePort): Promise<void> {
    // Return the port to the client via the service worker.
    const serviceWorker = await navigator.serviceWorker.ready;
    serviceWorker.active?.postMessage(message, [port]);
  }

  async #getClientId(): Promise<string> {
    // Getting the clientId from the service worker accomplishes two things:
    // 1. It gets the clientId for this context.
    // 2. It ensures that the service worker is activated.
    //
    // It is possible to do this without polling but it requires about the
    // same amount of code and using fetch makes 100% certain the service
    // worker is handling requests.
    // Use a Web Lock to determine our clientId.
    let clientId: string | null = null;
    while (!clientId) {
      clientId = await fetch("./clientId").then((response) => {
        if (response.ok) {
          return response.text();
        }
        console.warn("service worker not ready, retrying...");
        return new Promise((resolve) => setTimeout(resolve, 100));
      });
    }

    navigator.serviceWorker.addEventListener("message", (event) => {
      event.data.ports = event.ports;
      this.dispatchEvent(new MessageEvent("message", { data: event.data }));
    });
    // Acquire a Web Lock named after the clientId. This lets other contexts
    // track this context's lifetime.
    // TODO: It would be better to lock on the clientId+serviceName (passing
    // that lock name in the service request). That would allow independent
    // instance lifetime tracking.
    await SharedService.#acquireContextLock(clientId);

    return clientId;
  }

  async #providerChange(): Promise<MessagePort | null> {
    // Multiple calls to this function could be in flight at once. If that
    // happens, we only care about the most recent call, i.e. the one
    // assigned to this.#providerPort. This counter lets us determine
    // whether this call is still the most recent.
    const providerCounter = ++this.#providerCounter;

    // Obtain a MessagePort from the provider. The request can fail during
    // a provider transition, so retry until successful.
    /** @type {MessagePort} */ let providerPort: MessagePort | null = null;
    const clientId = await this.#clientId;
    while (!providerPort && providerCounter === this.#providerCounter) {
      // Broadcast a request for the port.
      const nonce = randomString();
      this.#clientChannel.postMessage({
        type: "request",
        nonce,
        sharedService: this.#serviceName,
        clientId,
      });

      // Wait for the provider to respond (via the service worker) or
      // timeout. A timeout can occur if there is no provider to receive
      // the broadcast or if the provider is too busy.
      const providerPortReady = new Promise<MessagePort>((resolve) => {
        const abortController = new AbortController();
        this.addEventListener(
          "message",
          (event) => {
            if ((event as MessageEvent).data?.nonce === nonce) {
              resolve((event as MessageEvent).data.ports[0]);
              abortController.abort();
            }
          },
          { signal: abortController.signal }
        );
        this.#providerChangeCleanup.push(() => abortController.abort());
      });

      providerPort = await Promise.race([
        providerPortReady,
        new Promise<null>((resolve) =>
          setTimeout(() => resolve(null), PROVIDER_REQUEST_TIMEOUT)
        ),
      ]);

      if (!providerPort) {
        // The provider request timed out. If it does eventually arrive
        // just close it.
        providerPortReady.then((port) => port?.close());
      }
    }

    if (providerPort && providerCounter === this.#providerCounter) {
      // Clean up all earlier attempts to get the provider port.
      this.#providerChangeCleanup.forEach((f) => f());
      this.#providerChangeCleanup = [];

      // Configure the port.
      providerPort.addEventListener("message", ({ data }) => {
        const callbacks = this.providerCallbacks.get(data.nonce);
        if (!data.error) {
          callbacks?.resolve(data.result);
        } else {
          callbacks?.reject(Object.assign(new Error(), data.error));
        }
      });
      providerPort.start();
      return providerPort;
    } else {
      // Either there is no port because this request timed out, or there
      // is a port but it is already obsolete because a new provider has
      // announced itself.
      providerPort?.close();
      return null;
    }
  }

  #closeProviderPort(providerPort: Promise<MessagePort | null>): void {
    providerPort.then((port) => port?.close());
    for (const { reject } of this.providerCallbacks.values()) {
      reject(new Error("SharedService provider change"));
    }
  }

  #createProxy(): any {
    return new Proxy(
      {},
      {
        get: (_, method) => {
          return async (...args: any[]) => {
            // Use a nonce to match up requests and responses. This allows
            // the responses to be out of order.
            const nonce = randomString();

            const providerPort = await this.#providerPort;
            console.log("finally", nonce, method, args);
            return new Promise((resolve, reject) => {
              this.providerCallbacks.set(nonce, { resolve, reject });
              providerPort?.postMessage({ nonce, method, args });
            }).finally(() => {
              this.providerCallbacks.delete(nonce);
            });
          };
        },
      }
    );
  }

  static #acquireContextLock = (function () {
    let p: Promise<void> | undefined;
    return function (clientId: string): Promise<void> {
      return p
        ? p
        : (p = new Promise((resolve) => {
            navigator.locks.request(
              clientId,
              () =>
                new Promise((_) => {
                  resolve();
                })
            );
          }));
    };
  })();
}

/**
 * Wrap a target with MessagePort for proxying.
 * @param {object} target
 * @returns
 */
export function createSharedServicePort(target: {
  [method: string]: (...args: any[]) => any;
}): MessagePort {
  const { port1: providerPort1, port2: providerPort2 } = new MessageChannel();
  providerPort1.addEventListener("message", ({ data: clientId }) => {
    const { port1, port2 } = new MessageChannel();

    // The port requester holds a lock while using the channel. When the
    // lock is released by the requester, clean up the port on this side.
    navigator.locks.request(clientId, () => {
      port1.close();
    });

    port1.addEventListener("message", async ({ data }) => {
      console.log("service worker received message", data);
      const response: any = { nonce: data.nonce };
      try {
        response.result = await target[data.method](...data.args);
      } catch (e: any) {
        // Error is not structured cloneable so copy into POJO.
        const error =
          e instanceof Error
            ? Object.fromEntries(
                Object.getOwnPropertyNames(e).map((k) => [k, e[k]])
              )
            : e;
        response.error = error;
      }
      port1.postMessage(response);
    });
    port1.start();
    providerPort1.postMessage(null, [port2]);
  });
  providerPort1.start();
  return providerPort2;
}

function randomString() {
  return Math.random().toString(36).replace("0.", "");
}
