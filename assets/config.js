window.MST_CONFIG = Object.freeze({
  // URL proxy server-side cho GeoVina, KHÔNG đặt API key GeoVina trong file này.
  // Ví dụ sau khi deploy Cloudflare Worker trong /worker:
  // geovinaProxyUrl: "https://mst-geovina-proxy.<your-subdomain>.workers.dev"
  geovinaProxyUrl: "",

  // Geocoder dùng để đối chiếu vị trí tham chiếu từ địa chỉ công khai.
  geocoder: "https://nominatim.openstreetmap.org/search",
  geocodeCacheDays: 30,

  // roadmap | satellite
  defaultMapType: "roadmap"
});
