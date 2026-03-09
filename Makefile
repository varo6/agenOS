IMAGE_NAME ?= agenos-live-build

.PHONY: build clean docker-image shell

build: docker-image
	./scripts/build-iso.sh

clean: docker-image
	./scripts/clean-build.sh

docker-image:
	docker build -t $(IMAGE_NAME) tools/live-build

shell: docker-image
	docker run --rm -it --privileged -v $(CURDIR):/workspace -w /workspace $(IMAGE_NAME) bash
