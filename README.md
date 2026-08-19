# MST — Tra cứu mã số thuế & doanh nghiệp Việt Nam

Trang web tĩnh, chạy trực tiếp trên trình duyệt, dùng để tra cứu thông tin doanh nghiệp và ngành nghề kinh doanh từ dữ liệu tham chiếu công khai.

## Chức năng

- Tra cứu theo **mã số thuế**, **tên doanh nghiệp** hoặc **người đại diện**.
- Hiển thị hồ sơ doanh nghiệp: tên, MST, tên quốc tế, tên viết tắt, địa chỉ, người đại diện, ngày hoạt động, cơ quan quản lý, loại hình doanh nghiệp, tình trạng và ngành nghề chính khi nguồn có cung cấp.
- Hiển thị **toàn bộ danh sách ngành nghề kinh doanh**, mã ngành và nội dung chi tiết.
- Lọc nhanh ngành nghề ngay trên kết quả.
- Sao chép MST / thông tin doanh nghiệp và in hồ sơ.
- Hỗ trợ URL tra cứu trực tiếp dạng `?q=4101695482`.
- Responsive cho desktop, tablet và mobile.
- Không dùng framework, không cần build, không lưu dữ liệu tra cứu trên máy chủ của dự án.

## Chạy cục bộ

Có thể mở `index.html` trực tiếp hoặc chạy một static server:

```bash
python -m http.server 8080
```

Sau đó mở `http://localhost:8080`.

## GitHub Pages

Trang được thiết kế để xuất bản tại:

`https://webgis-vinhlong.github.io/mst/`

Nếu Pages chưa được bật, vào **Settings → Pages** của repository và chọn nguồn phát hành phù hợp cho nhánh `main`.

## Nguồn dữ liệu

Giao diện hiện sử dụng các endpoint công khai của TopMST:

- `https://topmst.com/api/v1/search`
- `https://topmst.com/api/wp/v2/posts/{id}`

Dữ liệu chỉ mang tính tham chiếu. Khi dùng cho nghiệp vụ pháp lý, thuế, hóa đơn hoặc hợp đồng, cần đối chiếu với nguồn chính thức của cơ quan có thẩm quyền.

## Cấu trúc

```text
mst/
├── index.html
├── assets/
│   ├── app.js
│   └── style.css
├── .nojekyll
└── README.md
```

## Giấy phép

Phần mã nguồn giao diện của dự án có thể được mở rộng và tái sử dụng theo điều kiện giấy phép mà chủ repository lựa chọn. Dữ liệu bên thứ ba tuân theo điều khoản của nguồn cung cấp tương ứng.
