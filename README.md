# sub-store
# **一个功能强大的订阅转换器**

版本: 1.1 (含详细部署指南)  
日期: 2025年6月9日

![Screenshot_8.png](https://img.800122.xyz/file/1749524250714_Screenshot_8.png)

### **摘要**

本文档旨在全面阐述“通用订阅转换器”项目的技术实现、架构设计与核心功能。作为一个完全部署在Cloudflare全球边缘网络上的无服务器应用，本项目致力于为用户提供一个安全、高效、易用的订阅链接转换与分享解决方案。其核心特点在于**端到端加密**、**人机验证**、**自动化部署**以及**极低的运维成本**，为同类工具树立了新的安全与体验标杆。

### **1\. 系统功能与核心优势**

本应用的核心目标是解决不同网络代理客户端之间订阅格式不兼容的问题，并提供一种安全、临时的分享机制。

#### **1.1 主要功能**

* **多协议解析**：支持解析当前市面上绝大多数主流的分享链接格式，包括 **Shadowsocks (ss://)**, **ShadowsocksR (ssr://)**, **VLESS (vless://)**, **VMess (vmess://)**, **Trojan (trojan://)**, **TUIC (tuic://)** 和 **Hysteria2 (hysteria2://)**。  
* **格式转换与合并**：能将用户输入的多个、不同来源的分享链接或远程订阅，**合并并转换**为三种标准化的输出格式：  
  1. **Clash 订阅**: 生成符合Clash核心规范的YAML配置文件。  
  2. **Sing-box 配置文件**: 生成Sing-box核心兼容的JSON配置文件。  
  3. **通用订阅链接**: 生成一个Base64编码的、包含所有原始分享链接的纯文本订阅，广泛兼容V2RayN, NekoRay等客户端。  
* **安全分享机制**：  
  * **凭码提取**：所有转换结果都通过一个系统生成的、独一无二的UUID（提取码）进行访问，简化了分享流程。  
  * **自定义有效期**：用户可以为生成的提取码设置不同的生命周期，包括“会话（5分钟）”、“1天”、“7天”、“30天”，实现链接的自动销毁。

#### **1.2 核心优势：真正的无服务器架构**

本项目的最大优势在于其创新的部署模式：**仅一个域名（甚至无需自有域名）即可实现完整功能**。

* **零服务器运维**：整个应用完全构建于Cloudflare的无服务器平台之上，开发者无需购买、配置或维护任何传统服务器。  
* **全球加速**：所有后端逻辑（Cloudflare Workers）和静态资源（Cloudflare R2）都部署在全球Cloudflare的边缘节点上，全球用户都能享受到就近访问带来的低延迟体验。  
* **极高性价比**：得益于Cloudflare为Workers和R2提供的慷慨的免费额度，对于中小型个人项目而言，几乎可以实现**零成本**运行。  
* **高可用性与弹性伸缩**：依托Cloudflare强大的基础设施，应用天生具备高可用性和自动弹性伸缩的能力，无需担心流量突增带来的服务中断问题。

### **2\. 系统架构**

本应用采用现代Web开发的“前后端分离”架构，并在此基础上，将安全攸关的逻辑前移，构建了一个以**客户端为核心**的端到端加密系统。

* **前端 (Client-Side)**：  
  * **技术栈**: HTML, Tailwind CSS, Vanilla JavaScript, Crypto-JS。  
  * **角色**: 前端是整个应用的“智能终端”和“安全处理器”。它不仅负责构建用户界面（UI）和处理用户交互（UX），更承担了**全部的核心业务逻辑**。  
  * **部署**: 前端所有静态文件 (index.html, script.js, styles.css) 被部署在 **Cloudflare R2** 存储桶中，并通过Cloudflare网络全球分发。  
* **后端 (Server-Side)**：  
  * **技术栈**: Cloudflare Workers。  
  * **角色**: 在端到端加密架构下，后端被极度简化，沦为一个对内容一无所知的\*\*“加密数据仓库管理员”\*\*。  
  * **部署**: 后端Worker脚本通过**GitHub Actions**实现CI/CD，自动部署。  
* **架构图 (数据流)**  
  1. **生成**: 用户浏览器 \-\> (解析、生成、加密) \-\> 后端Worker \-\> (存储密文) \-\> R2  
  2. **提取**: 提取者浏览器 \-\> (请求密文) \-\> 后端Worker \-\> (读取密文) \-\> R2 \-\> (返回密文) \-\> 提取者浏览器 \-\> (解密、展示)

### **3\. 转换方式与原理**

本应用的核心——“转换”，完全在**客户端（用户的浏览器）** 内完成，这是实现端到端加密的前提。

* **解析原理**: 前端的 script.js 文件中包含了一系列专门的 parseXXX 函数，负责将各种格式的分享链接解析为统一的JavaScript对象。  
* **生成原理**: generateClashConfig 等函数同样在前端运行，它们接收解析后的节点对象，并按照目标客户端的规范，生成对应的配置文件文本。  
* **合并原理**: 在生成“通用订阅链接”时，前端脚本会维护一个所有有效原始分享链接的列表，然后进行整体的Base64编码，生成符合V2RayN等客户端规范的订阅内容。

### **4\. 存储桶使用与数据时限 (含详细配置)**

#### **4.1 存储桶的角色与TTL机制**

* **存储桶使用**: 本项目使用 **Cloudflare R2** 作为对象存储服务。R2的角色非常纯粹：它只负责存储由前端加密、后端提交的**加密数据包**。由于所有数据都是加密的，即使R2存储桶的数据意外泄露，攻击者也无法获取任何有价值的用户信息。  
* **数据存储时限 (TTL)**: 为了最大化保护用户隐私并避免垃圾数据堆积，系统实现了链接的自动销毁功能。在后端，当 /convert 接口接收到存储请求时，会根据前端传递的有效期参数，在向R2存储桶 put对象时，附带一个 expires 属性。一旦到达设定的过期时间，**Cloudflare会自动、永久地从R2中删除该对象**。

#### **4.2 如何创建并绑定R2存储桶**

要让Worker能够读写静态文件和加密数据，您必须创建一个R2存储桶并将其与Worker项目绑定。

1. **登录Cloudflare仪表盘**：访问 [dash.cloudflare.com](https://dash.cloudflare.com)。  
2. **导航至R2**：在左侧菜单中，点击 **R2**。  
3. **创建存储桶**：  
   * 点击 **创建存储桶 (Create bucket)** 按钮。  
   * **存储桶名称 (Bucket name)**：输入一个全局唯一的名称，例如 sub-converter-store。（请记下此名称，自动化部署时会用到）。  
   * **位置 (Location)**：保持默认的“自动 (Automatic)”即可。  
   * 点击 **创建存储桶 (Create bucket)**。  
4. **导航至您的Worker**：在左侧菜单中，点击 **Workers & Pages**，然后选择您的Worker项目。  
5. **绑定存储桶**：  
   * 进入Worker项目页面后，点击 **设置 (Settings)** \-\> **变量 (Variables)**。  
   * 向下滚动到 **R2 存储桶绑定 (R2 Bucket Bindings)** 部分，点击 **添加绑定 (Add binding)**。  
   * **变量名称 (Variable name)**：**必须准确地输入 SUB\_STORE**。这是您代码 (index.js) 中访问R2时使用的名称。  
   * **R2 存储桶 (R2 bucket)**：从下拉列表中，选择您在第3步创建的那个存储桶 (sub-converter-store)。  
   * 点击 **保存 (Save)**。

\[R2存储桶绑定设置的界面截图\]完成以上步骤后，您的Worker就获得了读写这个R2存储桶的权限。

### **5\. 系统加密方式与数据安全**

本项目将用户数据安全置于最高优先级，采用了**端到端加密 (End-to-End Encryption, E2EE)** 模型。

* **加密算法**: 使用业界标准、安全可靠的 **AES (Advanced Encryption Standard)** 对称加密算法，通过 Crypto-JS 这个成熟的第三方库在前端实现。  
* **密钥管理**:  
  * 加密和解密的**唯一密钥**，就是系统为每次转换生成的那个**提取码 (UUID)**。  
  * 这个密钥**仅在生成和提取时存在于用户的浏览器内存中**，它从未以任何形式被发送到服务器或被存储。  
* **安全保障**: 这种架构意味着，**本应用的服务提供者（即您本人）也无法查看或解密任何用户的订阅内容**。这是最高级别的隐私保护承诺，能让使用者完全放心其数据不会被盗用或审查。

### **6\. 人机验证与自动化部署 (含详细配置)**

#### **6.1 人机验证 (Cloudflare Turnstile) \- 详细配置指南**

为了启用人机验证功能，您需要从Cloudflare获取一个“站点密钥 (Site Key)”和一个“秘密密钥 (Secret Key)”。

1. **在Cloudflare创建Turnstile站点**  
   * 登录您的 [Cloudflare 仪表盘](https://dash.cloudflare.com)。  
   * 在左侧菜单中，找到并点击 **Turnstile**。  
   * 点击 **添加站点 (Add site)** 按钮。  
   * **站点名称 (Site name)**：给它取一个您能识别的名字，例如 我的订阅转换器。  
   * **域名 (Domain)**：输入您部署此应用的域名。**重要提示**：这里需要同时填写您计划使用的**自定义域名**（如 sub.otwx.top）和Cloudflare提供的**免费域名**（如 your-worker-name.workers.dev）。您可以点击“添加其他域”来输入多个。  
   * **小组件模式 (Widget Mode)**：选择 **“托管 (Managed)”**。这是最智能的模式，它会自动判断是否需要向用户展示交互式挑战。  
   * 点击 **创建 (Create)**。  
2. **获取密钥**  
   * 创建成功后，您会看到一个页面显示您的密钥。请复制并妥善保管这两个值：  
     * **站点密钥 (Site Key)**：这个是公开的，将用于前端 index.html。  
     * **秘密密钥 (Secret Key)**：这个**非常重要，绝不能泄露**。  
3. **在Worker中配置秘密密钥 (Secret Key)**  
   * 回到Cloudflare仪表盘，进入 **Workers & Pages** \-\> 您的Worker项目。  
   * 点击 **设置 (Settings)** \-\> **变量 (Variables)**。  
   * 在 **机密变量 (Encrypted Variables)** 部分（或旧版的“环境变量”下），点击 **添加变量 (Add variable)**。  
   * **变量名称 (Variable name)**：**必须准确地输入 TURNSTILE\_SECRET**。  
   * **值 (Value)**：将您上一步获取到的 **秘密密钥 (Secret Key)** 粘贴到这里。  
   * 点击 **加密并保存 (Encrypt and Save)**。

\[Worker中配置机密变量的界面截图\]

4. **在前端HTML中配置站点密钥 (Site Key)**  
   * 打开您本地项目中的 public/index.html 文件。  
   * 找到下面这行代码：  
     \<div class="cf-turnstile" data-sitekey="YOUR\_SITE\_KEY\_HERE"\>\</div\>

   * 将 YOUR\_SITE\_KEY\_HERE 这个占位符，**替换为您真实的站点密钥 (Site Key)**。

#### **6.2 自动化部署 (GitHub Actions) \- 详细配置指南**

使用GitHub Actions可以实现“代码推送到GitHub，网站自动更新”的现代化开发流程。

1. **在GitHub仓库中配置Secrets**  
   * 打开您的GitHub项目仓库页面，点击 **Settings** \-\> **Secrets and variables** \-\> **Actions**。  
   * 点击 **New repository secret** 按钮，依次创建以下**三个**Secret：  
     * **CLOUDFLARE\_API\_TOKEN**  
       * **获取方式**：登录Cloudflare仪表盘 \-\> 点击右上角您的头像 \-\> **我的个人资料 (My Profile)** \-\> **API令牌 (API Tokens)** \-\> **创建令牌 (Create Token)**。在“API令牌模板”部分，找到并点击 **编辑Cloudflare Workers (Edit Cloudflare Workers)** 模板旁的 **使用模板 (Use template)** 按钮。保持默认权限设置，继续创建令牌，然后**复制生成的令牌字符串**，粘贴到GitHub Secret的值中。  
     * **CLOUDFLARE\_ACCOUNT\_ID**  
       * **获取方式**：登录Cloudflare仪表盘，在主页右侧的菜单中，或者在任何域名的“概述”页面下方，您都可以找到您的 **账户ID (Account ID)**。复制它。  
     * **CLOUDFLARE\_R2\_BUCKET\_NAME**  
       * **值**：就是您在 **4.2节** 创建的R2存储桶的名称（例如 sub-converter-store）。  
2. **创建GitHub Actions工作流文件**  
   * 在您的本地项目代码的根目录下，创建 .github/workflows/ 文件夹结构。  
   * 在该文件夹中，创建一个新文件，名为 deploy.yml。  
   * 将以下内容**完整地**复制并粘贴到 deploy.yml 文件中：
```
# GitHub Actions 工作流名称  
name: Deploy to Cloudflare

# 触发条件：当代码被推送到 main 分支时自动运行  
on:  
  push:  
    branches:  
      - main # 您可以根据您的主分支名称修改，如 master

jobs:  
  deploy:  
    runs-on: ubuntu-latest  
    name: Deploy Worker and Static Assets  
    steps:  
      - name: Checkout  
        uses: actions/checkout@v3

      - name: Deploy  
        uses: cloudflare/wrangler-action@v3  
        with:  
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}  
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}  
          # 【核心命令】:   
          # 1. `wrangler deploy` 会自动读取 wrangler.toml 并部署Worker脚本。  
          # 2. `wrangler r2 object put` 会将静态文件上传到R2。  
          #    由于wrangler-action v3暂不支持直接上传整个目录，我们逐个上传核心文件。  
          command: |  
            wrangler deploy &&   
            wrangler r2 object put ${{ secrets.CLOUDFLARE_R2_BUCKET_NAME }}/index.html --file=public/index.html &&  
            wrangler r2 object put ${{ secrets.CLOUDFLARE_R2_BUCKET_NAME }}/script.js --file=public/script.js &&  
            wrangler r2 object put ${{ secrets.CLOUDFLARE_R2_BUCKET_NAME }}/styles.css --file=public/styles.css
```
3. **提交并推送代码**  
   * 将您修改过的 public/index.html (已填入站点密钥) 和新创建的 .github/workflows/deploy.yml 文件，通过 git 命令提交并推送到您的GitHub仓库的 main 分支。  
   * 推送后，您可以进入GitHub仓库的 **Actions** 标签页，查看工作流是否正在运行。  
4. **(可选但推荐) 禁用Cloudflare的Git集成**  
   * 既然我们现在使用更强大的GitHub Actions来推送部署，建议您禁用掉之前可能设置的从GitHub自动拉取的功能，以避免潜在的冲突。进入Cloudflare的 **Workers & Pages** \-\> 您的Worker项目 \-\> **设置 (Settings)** \-\> **构建与部署 (Builds & deployments)**，并断开与GitHub的连接。
