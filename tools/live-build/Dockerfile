FROM debian:bookworm

ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_MAJOR=22
ENV BUN_INSTALL=/usr/local/bun
ENV CARGO_HOME=/usr/local/cargo
ENV RUSTUP_HOME=/usr/local/rustup
ENV PATH=/usr/local/cargo/bin:/usr/local/bun/bin:${PATH}

RUN apt-get update && apt-get install -y \
    apt-utils \
    build-essential \
    ca-certificates \
    curl \
    debootstrap \
    dosfstools \
    file \
    gdisk \
    gnupg \
    grub-efi-amd64-bin \
    grub-pc-bin \
    isolinux \
    libayatana-appindicator3-dev \
    libgtk-3-dev \
    librsvg2-dev \
    libssl-dev \
    libwebkit2gtk-4.1-dev \
    libxdo-dev \
    live-build \
    mtools \
    pkg-config \
    rsync \
    squashfs-tools \
    syslinux-common \
    syslinux-utils \
    unzip \
    wget \
    xorriso \
    xz-utils \
    zstd \
  && mkdir -p /etc/apt/keyrings \
  && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
  && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list \
  && apt-get update && apt-get install -y nodejs \
  && curl -fsSL https://bun.sh/install | bash \
  && mkdir -p "${CARGO_HOME}" "${RUSTUP_HOME}" \
  && curl https://sh.rustup.rs -sSf | sh -s -- -y --profile minimal \
  && ln -sf /usr/local/bun/bin/bun /usr/local/bin/bun \
  && ln -sf /usr/local/bun/bin/bunx /usr/local/bin/bunx \
  && ln -sf "${CARGO_HOME}/bin/cargo" /usr/local/bin/cargo \
  && ln -sf "${CARGO_HOME}/bin/rustc" /usr/local/bin/rustc \
  && ln -sf "${CARGO_HOME}/bin/rustup" /usr/local/bin/rustup \
  && chmod -R 0777 "${CARGO_HOME}" "${RUSTUP_HOME}" \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace
