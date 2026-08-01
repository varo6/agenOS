IMAGE_NAME ?= agenos-live-build
VERSION ?=

.PHONY: build clean docker-image quick-test release release-build shell vm-live vm-disk vm-reset pi-harness-eval test

build:
	SKIP_DOCKER_BUILD=1 $(MAKE) docker-image
	./scripts/build-iso.sh

clean: docker-image
	./scripts/clean-build.sh

quick-test:
	$(MAKE) build
	$(MAKE) vm-live

pi-harness-eval:
	cd tools/pi-harness-eval && bun run eval -- $(ARGS)

# Cada suite se lanza desde su propio directorio a proposito. No hay
# package.json en la raiz, asi que un `bun test` suelto aqui recorre todo el
# arbol -- incluido build/live-build/chroot/usr/lib/node_modules -- y se cuelga.
test:
	cd components/ui && bun run test
	cd components/installer-ui && bun run test
	cd components/installer-ui && bun test ../agent
	python3 -m unittest discover -s tests -p 'test_*.py' -t tests

release:
	VERSION="$(VERSION)" ./scripts/release.sh

release-build:
	$(MAKE) build
	$(MAKE) release VERSION="$(VERSION)"

docker-image:
	docker build -t $(IMAGE_NAME) tools/live-build

shell: docker-image
	docker run --rm -it --privileged -v $(CURDIR):/workspace -w /workspace $(IMAGE_NAME) bash

vm-live:
	./scripts/run-vm.sh live

vm-disk:
	./scripts/run-vm.sh disk

vm-reset:
	./scripts/run-vm.sh reset
