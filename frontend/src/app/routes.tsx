import { createBrowserRouter } from 'react-router';
import { MonitorApp } from './monitor/MonitorApp';

const routeConfig = [{ path: '/', Component: MonitorApp }];

export const router = createBrowserRouter(routeConfig, {
  basename: '/monitoring-device',
});
