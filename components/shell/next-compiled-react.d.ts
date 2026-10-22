// The React canary that Next bundles ships without typings of its own. Its API
// is `react`'s (with the canary types Next already references), which is all
// screen-transition.test.tsx needs to render on it.
declare module "next/dist/compiled/react" {
  import React from "react";
  export = React;
}
declare module "next/dist/compiled/react-dom/client" {
  export * from "react-dom/client";
}
