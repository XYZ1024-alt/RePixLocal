import { createContext, useContext, type ReactNode } from "react";
import * as api from "@/api";

export type AppServices = typeof api;

const ServicesContext = createContext<AppServices>(api);

export function ServicesProvider({
  children,
  services = api
}: {
  children: ReactNode;
  services?: AppServices;
}) {
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

export function useServices() {
  return useContext(ServicesContext);
}
