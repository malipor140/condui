import { PipedVideo } from "~/types";
// import {
//   DBContext,
//   InstanceContext,
//   PlayerContext,
//   PreferencesContext,
//   getStorageValue,
//   setStorageValue,
// } from "../layout";
import Description from "~/components/Description";
import {
  Match,
  Show,
  Suspense,
  Switch,
  createEffect,
  createResource,
  createSignal,
  lazy,
  onCleanup,
  onMount,
  useContext,
} from "solid-js";
import {
  RouteDataArgs,
  createRouteData,
  useLocation,
  useRouteData,
} from "solid-start";
import { For } from "solid-js";
import { reconcile } from "solid-js/store";
import { InstanceContext, PlayerContext } from "~/root";
import { Portal, isServer } from "solid-js/web";
// const Description = lazy(() => import("~/components/Description"));
// const VideoCard = lazy(() => import("~/components/VideoCard"));
import VideoCard from "~/components/VideoCard";

export function extractVideoId(url: string | undefined): string | undefined {
  let id;
  if (url?.includes("/watch?v=")) {
    id = url.split("/watch?v=")[1];
  } else {
    id = url?.match("(?<=\/)([^\/]{11})(?=\/)")?.[0];
  }
  return id ?? undefined;
}
export async function fetchWithTimeout(
  resource: string,
  options: RequestInit & { timeout: number } = { timeout: 800 }
) {
  const { timeout } = options;

  const controller = new AbortController();
  const id = setTimeout(() => {
    console.log("aborting");
    controller.abort(`Request exceeded timeout of ${timeout}ms.`);
  }, timeout);
  console.log("fetching", controller.signal);
  const response = await fetch(resource, {
    ...options,
    signal: controller.signal,
  });
  clearTimeout(id);

  return response;
}

// export function routeData({ params, location, data }: RouteDataArgs) {
//   console.log(params, "params", location.query["v"], "v", data, "data");
//   return createRouteData(
//     async ([, v]) => {
//       const instance = "https://pipedapi.kavin.rocks";
//       try {
//         const res = await fetch(`${instance}/streams/${v}`, {
//           mode: "no-cors"
//         });
//         const data = await res.json();
//         console.log(typeof data, "piped video");
//         return data as PipedVideo;
//       } catch (err) {
//         console.log(err, "error while fetching video");
//         return err as Error;
//       }
//     },
//     {
//       key: () => ["v", location.query["v"]],
//     }
//   );
// }

export default function Watch() {
  console.log(new Date().toISOString().split("T")[1], "rendering watch page");

  const [video, setVideo] = useContext(PlayerContext);
  const [instance] = useContext(InstanceContext);
  const route = useLocation();
  // const videoLoaded = useSignal(false);
  // const preferences = useContext(PreferencesContext);
  // const instance = useContext(InstanceContext);
  // const db = useContext(DBContext);

  createEffect(async () => {
    const v = route.query.v;
    console.log(v, "v");
    if (!v) return;
    console.log(
      new Date().toISOString().split("T")[1],
      "visible task in watch page fetching video"
    );
    console.log("instance check", instance());
    console.time("useResource");
    const abortController = new AbortController();
    let data;

    console.log("fetching video", v, `${instance()}/streams/${v}`);
    try {
      const res = await fetch(`${instance()}/streams/${v}`, {
        signal: abortController.signal,
      });
      console.log(res.status, res.statusText, "status");
      data = await res.json();
      console.log(data, "data");
      setVideo({ value: data, error: undefined });
      // onResolved(data);
      console.log(typeof data, "piped video");
    } catch (err) {
      setVideo({ value: undefined, error: err as Error });
      console.log(err, "error while fetching video");
    }
  });
  // const fetcher = async (
  //   sourceOutput: any,
  //   info: { value: PipedVideo | undefined; refetching: any | boolean }
  // ) => {
  //   if (isServer) return;
  //   console.log(
  //     new Date().toISOString().split("T")[1],
  //     "fetcher in watch page fetching video"
  //   );
  //   const instance = "https://pipedapi.kavin.rocks";
  //   try {
  //     const res = await fetch(`${instance}/streams/${v}`);
  //     const data = await res.json();
  //     console.log(typeof data, "piped video");
  //     console.log(video.value, "video valu");
  //     return data;
  //   } catch (err) {
  //     console.log(err, "error while fetching video");
  //     setError({
  //       name: (err as Error).name,
  //       message: (err as Error).message,
  //     });
  //     return err;
  //   }
  // };

  // const [resource, { mutate, refetch }] = createResource(fetcher, {});

  // onMount(() => {
  //   refetch();
  // });

  // useTask$(async ({ track }) => {
  //   if (!v.value) return;
  //   track(() => v.value);
  //   track(() =>preferences.value.instanceUrl);

  //   error.value = { name: "", message: "" };
  //   let data;

  //   console.log("fetching video", v.value);
  //   try {
  //     const res = await fetchWithTimeout(`${preferences.value.instanceUrl}/streams/${v.value}`, {timeout: 5000});
  //     console.log(res.status, res.statusText, "status");
  //     data = await res.json();
  //     console.log(data, "piped video");
  //   } catch (err) {
  //     console.log(err);
  //     error.value = {
  //       name: (err as Error).name,
  //       message: (err as Error).message,
  //     };
  //   }
  //   if (data?.error) {
  //     error.value = {
  //       name: data.error,
  //       message: data.message,
  //     };
  //     return;
  //   }
  //   video.value = data;
  //   console.log(video.value?.title, "title1", data?.title);
  //   console.log(data, "video", playerContext.value);
  //   const persistedVideo = getStorageValue(
  //     "video",
  //     null,
  //     "json",
  //     "sessionStorage"
  //   );
  //   if (!video.value) return;
  //   if (
  //     extractVideoId(video.value.thumbnailUrl) ===
  //       extractVideoId(persistedVideo?.thumbnailUrl) &&
  //     document.querySelector("media-player")?.getAttribute("canplay") === "true"
  //   ) {
  //     console.log(
  //       "same video",
  //       extractVideoId(video.value.thumbnailUrl),
  //       extractVideoId(persistedVideo?.thumbnailUrl),
  //       document.querySelector("media-player")?.getAttribute("canplay")
  //     );

  //     return;
  //   }
  //   console.log("setting context value");
  //   playerContext.value = video.value;
  //   setStorageValue("video", JSON.stringify(video.value), "sessionStorage");
  //   console.log(video.value?.title, "title");
  // });

  return (
    <div class="flex flex-col md:flex-row w-full md:w-[calc(100%-20rem)]">
      <div class="md:min-h-[5540px] w-full">
        <div class="min-h-full w-full">
          <Switch fallback={<div>loading</div>}>
            {/* <Match when={resource.loading}>
                <div>loading</div>
              </Match> */}
            {/* <Match when={resource.error}>
                <div>error</div>
              </Match> */}
            <Match when={video.error} keyed>
              {(error) => <div>{error.message}</div>}
            </Match>
            <Match when={video.value} keyed>
              {(video) => <Description video={video} />}
            </Match>
          </Switch>
          {/* {video.value?.title} */}
        </div>
      </div>
      <div class="flex flex-col items-center gap-2 md:hidden">
        <For each={video.value?.relatedStreams}>
          {(stream) => {
            return <VideoCard v={stream} />;
          }}
        </For>
      </div>
    </div>
  );
}
