# MST — Tra cứu doanh nghiệp Việt Nam

**MST** là công cụ tra cứu độc lập do **Long Ngo** phát triển, phục vụ tra cứu nhanh mã số thuế, hồ sơ doanh nghiệp, người đại diện và ngành nghề kinh doanh từ nguồn dữ liệu công khai.

> **Lưu ý:** Dữ liệu được lấy tự động từ nguồn công khai và có thể chưa cập nhật kịp thời so với cơ quan thuế. Công cụ không phải cổng thông tin chính thức của cơ quan nhà nước.

## GitHub Pages

Trang được thiết kế để xuất bản tại:

`https://webgis-vinhlong.github.io/mst/`

Tra cứu trực tiếp bằng URL:

`https://webgis-vinhlong.github.io/mst/?q=4101695482`

Workflow trong `.github/workflows/pages.yml` tự động triển khai nội dung tĩnh khi có thay đổi trên nhánh `main`.

## Giao diện

Thiết kế theo phong cách tối giản **MS-DOS trắng / đen**, ưu tiên dữ liệu và khả năng đọc:

1. **Tra cứu** ở đầu trang — nhập mã số thuế, tên doanh nghiệp hoặc người đại diện.
2. **Kết quả doanh nghiệp** — tên, MST, trạng thái và các thao tác sao chép / in / xem nguồn.
3. **Bản đồ bên trái** — vị trí tham chiếu của địa chỉ doanh nghiệp, chế độ bản đồ / vệ tinh và liên kết Google Maps / Google Earth.
4. **Hồ sơ bên phải** — thông tin doanh nghiệp đầy đủ theo dữ liệu nguồn.
5. **Ngành nghề phía dưới** — toàn bộ mã ngành, tên ngành, nội dung chi tiết và bộ lọc tức thời.

Giao diện responsive cho desktop, tablet và mobile; không dùng framework và không cần bước build.

## Nguồn dữ liệu doanh nghiệp

Ứng dụng hiện đọc dữ liệu tham chiếu từ các endpoint công khai của TopMST:

- `https://topmst.com/api/v1/search`
- `https://topmst.com/api/wp/v2/posts/{id}`

Parser đọc bảng hồ sơ và bảng ngành nghề từ nội dung trả về, sau đó dựng giao diện bằng DOM / `textContent` để hạn chế việc chèn HTML không tin cậy từ nguồn ngoài.

## Bản đồ — Vietflex

Bản đồ sử dụng **Vietflex**, dự án mã nguồn mở do Long Ngo phát triển:

`https://github.com/Vietflexmap/VN`

Các tài nguyên CDN được ghim theo commit để tránh thay đổi ngoài ý muốn:

- CSS: `https://cdn.jsdelivr.net/gh/Vietflexmap/VN@6144d565fcf236727577ab3c4471bbe49f86892f/dist/vietflex.css`
- JavaScript: `https://cdn.jsdelivr.net/gh/Vietflexmap/VN@6144d565fcf236727577ab3c4471bbe49f86892f/dist/vietflex.js`

Trang hiện cho phép chuyển nhanh giữa **roadmap** và **satellite**. Chế độ tương thích Google tiles của Vietflex thuận tiện cho minh họa nhưng không phải endpoint Map Tiles API công khai được Google cam kết cho ứng dụng bên thứ ba; khi triển khai sản xuất dài hạn nên cấu hình Google Maps Platform chính thức theo điều khoản nhà cung cấp.

## Đối chiếu tọa độ địa chỉ

Địa chỉ doanh nghiệp được đối chiếu bằng Nominatim / OpenStreetMap theo từng thao tác tra cứu của người dùng:

- một truy vấn địa chỉ khi cần;
- giới hạn kết quả ở Việt Nam;
- không dùng cho autocomplete;
- kết quả được cache cục bộ trên trình duyệt theo thời hạn cấu hình.

Tọa độ trên bản đồ chỉ là **vị trí tham chiếu gần địa chỉ công khai**, không phải tọa độ đo đạc pháp lý hoặc bằng chứng về ranh thửa.

## Ranh giới hành chính — GeoVina

GeoVina được dùng để:

1. phân tích địa chỉ doanh nghiệp;
2. xác định tỉnh / thành phố mới;
3. xác định xã / phường / đặc khu mới;
4. lấy GeoJSON ranh giới `new-province` và `new-ward`;
5. hiển thị các polygon đó trên Vietflex.

### Vì sao không đặt API key trong `assets/app.js`?

GitHub Pages là website tĩnh. Bất kỳ API key nào đặt trong HTML hoặc JavaScript đều có thể bị người truy cập xem và sao chép.

Vì vậy repo **không chứa GeoVina API key**. Frontend chỉ gọi một proxy server-side được cấu hình trong `assets/config.js`; proxy mới thêm header `X-Api-Key` khi gọi GeoVina.

### Proxy mẫu bằng Cloudflare Workers

Repo có sẵn:

```text
worker/
├── geovina-proxy.js
└── wrangler.toml.example
```

Triển khai mẫu:

```bash
cd worker
cp wrangler.toml.example wrangler.toml
npx wrangler deploy
npx wrangler secret put GEOVINA_API_KEY
```

Nhập API key GeoVina khi Wrangler yêu cầu. Không ghi key vào `wrangler.toml`, `config.js`, commit hoặc GitHub Actions log.

Sau khi Worker có URL, cập nhật `assets/config.js`:

```js
window.MST_CONFIG = Object.freeze({
  geovinaProxyUrl: "https://mst-geovina-proxy.<your-subdomain>.workers.dev",
  geocoder: "https://nominatim.openstreetmap.org/search",
  geocodeCacheDays: 30,
  defaultMapType: "roadmap"
});
```

Frontend sẽ gọi:

```text
GET <proxy>/parse?address=...
GET <proxy>/new-boundaries?type=new-province&province_ids=..
GET <proxy>/new-boundaries?type=new-ward&province_ids=..
```

Worker chỉ cho phép các tuyến cần thiết, kiểm tra tham số, giới hạn CORS về origin cấu hình và giữ `GEOVINA_API_KEY` ở secret phía server.

## Cấu trúc dự án

```text
mst/
├── index.html
├── assets/
│   ├── app.js
│   ├── config.js
│   └── style.css
├── worker/
│   ├── geovina-proxy.js
│   └── wrangler.toml.example
├── .github/
│   └── workflows/
│       └── pages.yml
├── .nojekyll
└── README.md
```

## Chạy cục bộ

```bash
python -m http.server 8080
```

Sau đó mở:

`http://localhost:8080`

## Nguyên tắc dữ liệu và bảo mật

- Không lưu dữ liệu tra cứu trên máy chủ của dự án GitHub Pages.
- Không commit API key, token hoặc secret vào repo.
- Dữ liệu từ bên thứ ba chỉ dùng làm dữ liệu tham chiếu và tuân theo điều khoản nguồn tương ứng.
- Với nghiệp vụ pháp lý, thuế, hóa đơn, hợp đồng hoặc thẩm định doanh nghiệp, phải đối chiếu với cơ quan / nguồn chính thức có thẩm quyền.

---

**Công cụ tra cứu độc lập, do Long Ngo phát triển.**  
Dữ liệu được lấy tự động từ nguồn công khai và có thể chưa cập nhật kịp thời so với cơ quan thuế.
