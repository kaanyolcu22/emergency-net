import { RouteObject } from "react-router-dom";
import Register from "./Pages/Register";
import HelloWrapper from "./Components/HelloWrapper";
import Home from "./Pages/Home";
import Channel from "./Pages/Channel";
import SyncWrapper from "./Components/SyncWrapper";
import PURegister from "./Pages/PURegister";
import RecoveryWords from "./Pages/RecoveryWords";
import Recovery from "./Pages/Recovery";
import CrossAPRecovery from "./Pages/CrossAPRecovery"

export const routes: RouteObject[] = [
  {
    path: "/",
    element: <HelloWrapper />,
    children: [
      { path: "", element: <Register /> },
      { path: "register", element: <Register /> },
      { path: "PUregister", element: <PURegister /> },
      
      
      {
        element: <SyncWrapper />,
        children: [
          { path: "home", element: <Home /> },
          { path: "channel/:channelName", element: <Channel /> },
          { path: "/recovery", element: <Recovery /> },
          { path: "/cross-ap-recovery", element: <CrossAPRecovery /> },
          { path: "/recovery-words", element: <RecoveryWords /> }
        ],
      },
    ],
  },
];