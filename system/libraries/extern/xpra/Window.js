const HIDE_BORDERS = true;

function dummy() {
    //this placeholder function does nothing
}

class XpraWindow {
    constructor(
        client,
        wid,
        x,
        y,
        w,
        h,
        metadata,
        override_redirect,
        tray,
        client_properties,
        geometry_callback,
        mouse_move_callback,
        mouse_down_callback,
        mouse_up_callback,
        mouse_scroll_callback,
        set_focus_callback,
        window_closed_callback
    ) {
        this.client = client;
        this.wid = wid;

        this.metadata = {};
        this.override_redirect = override_redirect;
        this.tray = tray;
        this.has_alpha = false;
        this.client_properties = client_properties;

        this.set_focus_cb = set_focus_callback || dummy;
        this.mouse_move_cb = mouse_move_callback || dummy;
        this.mouse_down_cb = mouse_down_callback || dummy;
        this.mouse_up_cb = mouse_up_callback || dummy;
        this.mouse_scroll_cb = mouse_scroll_callback || dummy;
        this.geometry_cb = geometry_callback || dummy;
        this.window_closed_cb = window_closed_callback || dummy;

        this.title = "X11 window";
        this.windowtype = "NORMAL";

        this.x = x;
        this.y = y;
        this.w = w;
        this.h = h;

        this.fullscreen = false;
        this.saved_geometry = null;
        this.minimized = false;
        this.maximized = false;
        this.focused = false;
        this.decorations = true;
        this.has_decorations = false;
        this.resizable = false;
        this.stacking_layer = 0;
        this.initialized = false;

        this.debug_categories = client.debug_categories;

        // offsets
        this.topoffset = 0;
        this.bottomoffset = 0;
        this.leftoffset = 0;
        this.rightoffset = 0;

        this.set_offsets();

        this.wnd = new w96.StandardWindow({
            initialX: x,
            initialY: y,
            title: this.title,
            initialHeight: h + this.topoffset + this.bottomoffset,
            initialWidth: w + this.leftoffset + this.rightoffset,
            resizable: this.resizable,
        });

        // EVENTS
        this.wnd.onclose = ((e) => {
            e.canceled = true;
            this.window_closed_cb(this);
        }).bind(this);
        this.wnd.onresize = this.handle_resized.bind(this);
        this.wnd.onmove = this.handle_moved.bind(this);
        this.wnd.onminimize = (() => {
            if (this.wnd.minimized !== this.minimized) {
                this.toggle_minimized(this.wnd.minimized);
            }
        }).bind(this);
        this.wnd.onactivate = this.focus.bind(this);
        this.wnd.ondeactivate = this.unfocus.bind(this);

        this.div = this.wnd.wndObject;
        this.divBody = this.div.querySelector(".window-html-content");

        this.canvas = null;
        this.init_canvas();

        this.update_metadata(metadata, true);

        if (this.client.server_is_desktop || this.client.server_is_shadow) {
            jQuery(this.divBody).addClass("desktop");
            this.resizable = false;
        } else if (this.tray) {
            jQuery(this.divBody).addClass("tray");
        } else if (this.override_redirect) {
            jQuery(this.divBody).addClass("override-redirect");
        } else if (
            this.windowtype == "" ||
            this.windowtype === "NORMAL" ||
            this.windowtype === "DIALOG" ||
            this.windowtype === "UTILITY"
        ) {
            this.resizable = true;
            this.wnd.params.resizable = true;
        }

        this.div.style.minWidth = 0;
        this.div.style.minHeight = 0;

        if (!(this.resizable || metadata["decorations"])) {
            this.wnd.animations.windowOpen = "anim-null";
            this.wnd.animations.windowClose = "anim-null";
            this.wnd.params.ignoreFocus = true;
            this.hide_decorations();
        } else if (this.windowtype === "NORMAL") this.wnd.registerAppBar();

        this.canMinimize = "MIN";

        if (this.windowtype === "DIALOG") {
            this.canMinimize = "";
            this.wnd.setControlBoxStyle("WS_CBX_CLOSE");
        }

        if (this.tray){
            this.div.classList.add("notify-icon", "notify-item");

            const notifyIcon = new w96.shell.NotifyIcon();
            notifyIcon.notifyEl.remove();
            this.div.parentNode.removeChild(this.div);
            notifyIcon.notifyEl = this.div;
            w96.shell.Taskbar.registerNotifyIcon(notifyIcon);

            this.div.classList.remove("window-dlg", "ifr");
            this.div.style.removeProperty("position");
        }

        if (
            this.windowtype === "TOOLTIP" ||
            this.windowtype === "DROPDOWN_MENU" ||
            this.windowtype === "POPUP_MENU"
        ) {
            this.wnd.params.zLayer = "HIGH";
        }

        this.wnd.show();
        this.updateCSSGeometry();
        this.update_metadata(metadata);
        this.initialized = true;

        if (this.tray){
            this.handle_moved();
            this.wnd.setPosition(0, 0);
        }
    }

    set_offsets(){
        // Windows 96
        this.topoffset = 20;
        this.bottomoffset = 0;
        this.leftoffset = 0;
        this.rightoffset = 0;
    }

    reset_offsets(){
        this.topoffset = 0;
        this.bottomoffset = 0;
        this.leftoffset = 0;
        this.rightoffset = 0;
    }

    hide_decorations() {
        if (HIDE_BORDERS){
            this.div.style.backgroundColor = "#0000";
            this.div.style.padding = 0;
            this.divBody.parentElement.style.paddingTop = 0;
            if (this.tray){
                this.div.style.boxShadow = "none";
            }else {
                this.div.style.boxShadow = "4px 4px 7px #0008, -1px -1px 4px #0008";
            }
            this.div.style.border = "none";
        }
        this.div.querySelector('.titlebar').style.display = 'none';
        this.wnd.setWindowIcon(null);
        this.noDecorations = true;
        this.reset_offsets();
        this.wnd.setSize(
            this.w + this.leftoffset + this.rightoffset,
            this.h + this.topoffset + this.bottomoffset
        );
    }

    show_decorations() {
        if (HIDE_BORDERS){
            this.div.style.removeProperty("background-color");
            this.div.style.removeProperty("padding");
            this.divBody.parentElement.style.removeProperty("padding-top");
            this.div.style.removeProperty("box-shadow");
            this.div.style.removeProperty("border");
        }
        this.div.querySelector('.titlebar').style.display = 'block';
        this.decorations = true;
        this.set_offsets();
        this.wnd.setSize(
            this.w + this.leftoffset + this.rightoffset,
            this.h + this.topoffset + this.bottomoffset
        );
    }

    _set_decorated(decorated) {
        if (decorated === this.decorations) {
            return;
        }
        this.decorations = decorated;
        if (decorated) this.show_decorations();
        if (!decorated) this.hide_decorations();
    }

    update_metadata(metadata, safe) {
        for (const attrname in metadata) {
            this.metadata[attrname] = metadata[attrname];
        }
        if (safe) {
            this.set_metadata_safe(metadata);
        } else {
            this.set_metadata(metadata);
        }
    }

    _set_alpha(alpha){
        if (alpha === this.has_alpha) {
            return;
        }
        this.has_alpha = alpha;
    }

    set_metadata_safe(metadata) {
        console.log(metadata);

        if ("title" in metadata) {
            let title = Utilities.s(metadata["title"]);
            if (this.title != title) {
                this.title = title;
                this.wnd.setTitle(title);
            }
        }
        if ("has-alpha" in metadata) {
            this._set_alpha(metadata["has-alpha"]);
        }
        if ("window-type" in metadata) {
            this.windowtype = Utilities.s(metadata["window-type"][0]);
        }
        if ("decorations" in metadata) {
            this._set_decorated(metadata["decorations"]);
            if (this.initialized) {
                this.updateCSSGeometry();
                this.handle_resized();
                this.apply_size_constraints();
            }
        }
        if ("opacity" in metadata) {
            let opacity = metadata["opacity"];
            opacity = opacity < 0 ? 1 : opacity / 0x1_00_00_00_00;
            jQuery(this.div).css("opacity", `${opacity}`);
        }
        if ("iconic" in metadata) {
            this.set_minimized(metadata["iconic"] == 1);
        }

        if (this.resizable && "size-constraints" in metadata) {
            this.apply_size_constraints();
        }
    }

    set_metadata(metadata) {
        this.set_metadata_safe(metadata);
        if ("fullscreen" in metadata) {
            this.set_fullscreen(metadata["fullscreen"] == 1);
        }
        if ("maximized" in metadata) {
            this.set_maximized(metadata["maximized"] == 1);
        }
    }

    set_minimized(minimized) {
        if (this.minimized == minimized) {
            return;
        }
        this.minimized = minimized;
        if (minimized) {
            if (!this.wnd.minimized) this.wnd.toggleMinimize();
        } else {
            if (this.wnd.minimized) this.wnd.toggleMinimize();
        }
    }

    /**
     * Returns the geometry of the window backing image,
     * the inner window geometry (without any borders or top bar).
     */
    get_internal_geometry() {
        return {
            x: this.x,
            y: this.y,
            w: this.w,
            h: this.h,
        };
    }

    reset_cursor() {
        jQuery(this.div).css("cursor", "default");
        this.cursor_data = null;
    }

    update_icon(width, height, encoding, img_data) {
        // Cache the icon.
        this.icon = {
            width,
            height,
            encoding,
            img_data,
        };

        let source = "favicon.png";
        if (encoding == "png") {
            if (typeof img_data === "string") {
                const uint = new Uint8Array(img_data.length);
                for (let index = 0; index < img_data.length; ++index) {
                    uint[index] = img_data.charCodeAt(index);
                }
                img_data = uint;
            }
            source = this.construct_base64_image_url(encoding, img_data);
        }
        if (this.decorations) this.wnd.setWindowIcon(source);
        return source;
    }

    construct_base64_image_url(encoding, imageDataArrayBuffer) {
        const imageDataBase64 = Utilities.ArrayBufferToBase64(imageDataArrayBuffer);
        return `data:image/${encoding};base64,${imageDataBase64}`;
    }

    updateFocus() {
        // Not needed
    }

    update_zindex() {
        // This is not needed
    }

    destroy() {
        this.client.capture_keyboard = false;
        this.wnd.close(true);
    }

    init_canvas() {
        this.canvas = null;
        jQuery(this.divBody).find("canvas").remove();
        const canvas = document.createElement("canvas");
        if (this.client.try_gpu) {
            $(canvas).addClass("gpu-trigger");
        }
        // set initial sizes
        canvas.width = this.w;
        canvas.height = this.h;
        this.canvas = canvas;
        this.divBody.append(canvas);
        if (this.client.offscreen_api) {
            // Transfer canvas control.
            this.transfer_canvas(canvas);
        } else {
            //we're going to paint from this class:
            this.canvas_ctx = this.canvas.getContext("2d");
            this.canvas_ctx.imageSmoothingEnabled = false;

            this.init_offscreen_canvas();

            this.draw_canvas = this.offscreen_canvas;
            this.paint_queue = [];
            this.paint_pending = 0;
        }
        this.register_canvas_mouse_events(this.canvas);
        this.register_canvas_pointer_events(this.canvas);
    }

    transfer_canvas(canvas) {
        const offscreen_handle = canvas.transferControlToOffscreen();
        this.client.decode_worker.postMessage(
            {
                cmd: "canvas",
                wid: this.wid,
                canvas: offscreen_handle,
                debug: this.debug_categories.includes("draw"),
            },
            [offscreen_handle]
        );
    }

    init_offscreen_canvas() {
        this.offscreen_canvas = document.createElement("canvas");
        this.offscreen_canvas.width = this.w;
        this.offscreen_canvas.height = this.h;
        this.offscreen_canvas_ctx = this.offscreen_canvas.getContext("2d");
        this.offscreen_canvas_ctx.imageSmoothingEnabled = false;
    }

    register_canvas_mouse_events(canvas) {
        // Hook up the events we want to receive:
        jQuery(canvas).mousedown((e) => {
            this.on_mousedown(e);
        });
        jQuery(canvas).mouseup((e) => {
            this.on_mouseup(e);
        });
        jQuery(canvas).mousemove((e) => {
            this.on_mousemove(e);
        });
    }

    register_canvas_pointer_events(canvas) {
        if (!window.PointerEvent) {
            return;
        }
        canvas.addEventListener("pointerdown", (event_) => {
            if (event_.pointerType == "touch") {
                this.pointer_down = event_.pointerId;
                this.pointer_last_x = event_.offsetX;
                this.pointer_last_y = event_.offsetY;
            }
        });
        canvas.addEventListener("pointermove", (event_) => {
            if (this.pointer_down == event_.pointerId) {
                const dx = event_.offsetX - this.pointer_last_x;
                const dy = event_.offsetY - this.pointer_last_y;
                this.pointer_last_x = event_.offsetX;
                this.pointer_last_y = event_.offsetY;
                const mult = 20 * (window.devicePixelRatio || 1);
                event_.wheelDeltaX = Math.round(dx * mult);
                event_.wheelDeltaY = Math.round(dy * mult);
                this.on_mousescroll(event_);
            }
        });
        canvas.addEventListener("pointerup", (event_) => {
            this.pointer_down = -1;
        });
        canvas.addEventListener("pointercancel", (event_) => {
            this.pointer_down = -1;
        });
        //wheel events on a window:
        const me = this;
        function on_mousescroll(e) {
            me.on_mousescroll(e);
            e.stopPropagation();
            return e.preventDefault();
        }
        if (Utilities.isEventSupported("wheel")) {
            canvas.addEventListener("wheel", on_mousescroll, false);
        } else if (Utilities.isEventSupported("mousewheel")) {
            canvas.addEventListener("mousewheel", on_mousescroll, false);
        } else if (Utilities.isEventSupported("DOMMouseScroll")) {
            canvas.addEventListener("DOMMouseScroll", on_mousescroll, false); // for Firefox
        }
    }

    /**
     * Mouse: delegate to client, telling it which window triggered the event.
     */
    on_mousemove(e) {
        return this.mouse_move_cb(e, this);
    }

    on_mousedown(e) {
        return this.mouse_down_cb(e, this);
    }

    on_mouseup(e) {
        return this.mouse_up_cb(e, this);
    }

    on_mousescroll(e) {
        return this.mouse_scroll_cb(e, this);
    }

    suspend() {
        // ...
    }

    resume() {
        this.init_canvas();
    }

    focus() {
        this.client.capture_keyboard = true;
        this.set_focus_cb(this);
    }

    unfocus() {
        this.client.capture_keyboard = false;
    }

    updateCanvasGeometry() {
        if (this.client.offscreen_api) {
            this.client.decode_worker.postMessage({
                cmd: "canvas-geo",
                wid: this.wid,
                w: this.w,
                h: this.h,
            });
            return;
        }
        if (this.canvas) {
            // set size of both canvas if needed
            if (this.canvas.width != this.w) {
                this.canvas.width = this.w;
            }
            if (this.canvas.height != this.h) {
                this.canvas.height = this.h;
            }
            if (this.offscreen_canvas.width != this.w) {
                this.offscreen_canvas.width = this.w;
            }
            if (this.offscreen_canvas.height != this.h) {
                this.offscreen_canvas.height = this.h;
            }
        }
    }

    swap_buffers() {
        //the up to date canvas is what we'll draw on screen:
        this.draw_canvas = this.offscreen_canvas;
        this.init_offscreen_canvas();
        this.offscreen_canvas_ctx.drawImage(this.draw_canvas, 0, 0);
    }

    /**
     * Updates the window image with new pixel data
     * we have received from the server.
     * The image is painted into off-screen canvas.
     */
    paint() {
        if (this.client.decode_worker) {
            //no need to synchronize paint packets here
            //the decode worker ensures that we get the packets
            //in the correct order, ready to update the canvas
            Reflect.apply(this.do_paint, this, arguments);
            return;
        }
        //process all paint request in order using the paint_queue:
        const item = Array.prototype.slice.call(arguments);
        this.paint_queue.push(item);
        this.may_paint_now();
    }

    /**
     * Pick items from the paint_queue
     * if we're not already in the process of painting something.
     */
    may_paint_now() {
        let now = performance.now();
        while (
            (this.paint_pending == 0 || now - this.paint_pending >= 2000) &&
            this.paint_queue.length > 0
        ) {
            this.paint_pending = now;
            const item = this.paint_queue.shift();
            this.do_paint.apply(this, item);
            now = performance.now();
        }
    }

    paint_box(color, px, py, pw, ph) {
        this.offscreen_canvas_ctx.strokeStyle = color;
        this.offscreen_canvas_ctx.lineWidth = 2;
        this.offscreen_canvas_ctx.strokeRect(px, py, pw, ph);
    }

    do_paint(packet, decode_callback) {
        const me = this;

        const x = packet[2];
        const y = packet[3];
        const width = packet[4];
        const height = packet[5];
        const img_data = packet[7];
        const options = packet[10] || {};
        let coding = Utilities.s(packet[6]);
        let enc_width = width;
        let enc_height = height;
        const scaled_size = options["scaled_size"];

        if (scaled_size) {
            enc_width = scaled_size[0];
            enc_height = scaled_size[1];
        }

        const bitmap = coding.startsWith("bitmap:");
        if (bitmap) {
            coding = coding.split(":")[1];
        }

        function painted(skip_box) {
            me.paint_pending = 0;
            if (!skip_box && me.debug_categories.includes("draw")) {
                const color = DEFAULT_BOX_COLORS[coding] || "white";
                this.paint_box(color, x, y, width, height);
            }
            decode_callback();
        }

        function paint_error(e) {
            console.error("error painting", coding, e);
            me.paint_pending = 0;
            decode_callback(`${e}`);
        }

        function paint_bitmap() {
            //the decode worker is giving us a Bitmap object ready to use:
            me.offscreen_canvas_ctx.clearRect(x, y, img_data.width, img_data.height);
            me.offscreen_canvas_ctx.drawImage(img_data, x, y);
            painted();
            //this isn't really needed since we don't use the paint_queue at all
            //when decoding in the worker (bitmaps can only come from the decode worker)
            me.may_paint_now();
        }

        try {
            if (coding == "void") {
                painted(true);
                this.may_paint_now();
            } else if (coding == "rgb32" || coding == "rgb24") {
                if (bitmap) {
                    paint_bitmap();
                    return;
                }
                const rgb_data = decode_rgb(packet);
                const img = this.offscreen_canvas_ctx.createImageData(enc_width, enc_height);
                img.data.set(rgb_data);
                this.offscreen_canvas_ctx.putImageData(img, x, y, 0, 0, width, height);
                painted();
                this.may_paint_now();
            } else if (
                coding == "jpeg" ||
                coding.startsWith("png") ||
                coding == "webp"
            ) {
                if (bitmap) {
                    paint_bitmap();
                    return;
                }
                const image = new Image();
                image.addEventListener("load", () => {
                    if (image.width == 0 || image.height == 0) {
                        paint_error(`invalid image size: ${image.width}x${image.height}`);
                    } else {
                        this.offscreen_canvas_ctx.clearRect(x, y, width, height);
                        this.offscreen_canvas_ctx.drawImage(image, x, y, width, height);
                        painted();
                    }
                    this.may_paint_now();
                });
                image.onerror = () => {
                    paint_error(`failed to load ${coding} into image tag`);
                    this.may_paint_now();
                };
                const paint_coding = coding.split("/")[0]; //ie: "png/P" -> "png"
                image.src = this.construct_base64_image_url(paint_coding, img_data);
            } else if (coding == "h264") {
                paint_error("h264 decoding is only supported via the decode workers");
                this.may_paint_now();
            } else if (coding == "scroll") {
                for (let index = 0, stop = img_data.length; index < stop; ++index) {
                    const scroll_data = img_data[index];
                    const sx = scroll_data[0];
                    const sy = scroll_data[1];
                    const sw = scroll_data[2];
                    const sh = scroll_data[3];
                    const xdelta = scroll_data[4];
                    const ydelta = scroll_data[5];
                    this.offscreen_canvas_ctx.drawImage(
                        this.draw_canvas,
                        sx,
                        sy,
                        sw,
                        sh,
                        sx + xdelta,
                        sy + ydelta,
                        sw,
                        sh
                    );
                    if (this.debug_categories.includes("draw")) {
                        this.paint_box("brown", sx + xdelta, sy + ydelta, sw, sh);
                    }
                }
                painted(true);
                this.may_paint_now();
            } else {
                paint_error("unsupported encoding");
            }
        } catch (error) {
            const packet_sequence = packet[8];
            this.exc(error, "error painting", coding, "sequence no", packet_sequence);
            paint_error(error);
        }
    }

    exc() {
        if (this.client) this.client.exc.apply(this.client, arguments);
    }

    draw() {
        //pass the 'buffer' canvas directly to visible canvas context
        if (this.has_alpha || this.tray) {
            this.canvas_ctx.clearRect(
                0,
                0,
                this.draw_canvas.width,
                this.draw_canvas.height
            );
        }
        this.canvas_ctx.drawImage(this.draw_canvas, 0, 0);
    }

    move_resize(x, y, w, h) {
        // only do it if actually changed!
        if (this.w != w || this.h != h || this.x != x || this.y != y) {
            this.w = w;
            this.h = h;
            this.x = x;
            this.y = y;
            if (!this.ensure_visible()) {
                this.geometry_cb(this);
            } else {
                this.updateCSSGeometry();
            }
        }
    }

    updateCSSGeometry() {
        // set size of canvas
        this.updateCanvasGeometry();
        // work out outer size
        this.outerH = this.h + this.topoffset + this.bottomoffset;
        this.outerW = this.w + this.leftoffset + this.rightoffset;
        // set width and height
        this.wnd.setSize(this.outerW, this.outerH);
        // set CSS attributes to outerX and outerY
        this.outerX = this.x - this.leftoffset;
        this.outerY = this.y - this.topoffset;
        if (!this.tray){
            this.wnd.setPosition(this.outerX, this.outerY);
        }
    }

    ensure_visible() {
        if (this.client.server_is_desktop || this.client.server_is_shadow) {
            //those windows should usually be centered on screen,
            //moving them would mess that up
            return true;
        }
        if (this.override_redirect) {
            //OR windows cannot be moved server-side
            return true;
        }
        const oldx = this.x;
        const oldy = this.y;
        // for now make sure we don't out of top left
        // this will be much smarter!
        const min_visible = 80;
        const desktop_size = this.client._get_desktop_size();
        const ww = desktop_size[0];
        const wh = desktop_size[1];
        if (oldx < this.leftoffset && oldx + this.w <= min_visible) {
            this.x = min_visible - this.w + this.leftoffset;
        } else if (oldx >= ww - min_visible) {
            this.x = Math.min(oldx, ww - min_visible);
        }
        if (oldy <= this.topoffset && oldy <= min_visible) {
            this.y = Number.parseInt(this.topoffset);
        } else if (oldy >= wh - min_visible) {
            this.y = Math.min(oldy, wh - min_visible);
        }
        if (oldx != this.x || oldy != this.y) {
            this.updateCSSGeometry();
            return false;
        }
        return true;
    }

    move(x, y) {
        this.move_resize(x, y, this.w, this.h);
    }

    resize(w, h) {
        this.move_resize(this.x, this.y, w, h);
    }

    set_cursor(encoding, w, h, xhot, yhot, img_data) {
        if (encoding != "png") {
            console.warn("received an invalid cursor encoding:", encoding);
            return;
        }
        let array = img_data;
        if (typeof img_data === "string") {
            array = Utilities.StringToUint8(img_data);
        }
        const window_element = jQuery(this.divBody);
        const cursor_url = this.construct_base64_image_url(encoding, array);
        const me = this;
        function set_cursor_url(url, x, y, w, h) {
            const url_string = `url('${url}')`;
            window_element.css("cursor", `${url_string}, default`);
            window_element.css("cursor", `${url_string} ${x} ${y}, auto`);
            me.cursor_data = [url, x, y, w, h];
        }
        let zoom = detectZoom.zoom();
        if (Math.round(zoom * 4) == 2 * Math.round(zoom * 2)) {
            zoom = Math.round(zoom * 2) / 2;
        }
        if (zoom != 1 && !Utilities.isMacOS()) {
            const temporary_img = new Image();
            temporary_img.addEventListener("load", () => {
                const canvas = document.createElement("canvas");
                const context = canvas.getContext("2d");
                context.imageSmoothingEnabled = false;
                canvas.width = Math.round(w * window.devicePixelRatio);
                canvas.height = Math.round(h * window.devicePixelRatio);
                context.drawImage(temporary_img, 0, 0, canvas.width, canvas.height);
                const scaled_cursor_url = canvas.toDataURL();
                set_cursor_url(
                    scaled_cursor_url,
                    Math.round(xhot * window.devicePixelRatio),
                    Math.round(yhot * window.devicePixelRatio),
                    Math.round(canvas.width),
                    Math.round(canvas.height),
                );
            });
            temporary_img.src = cursor_url;
        } else {
            set_cursor_url(cursor_url, xhot, yhot, w, h);
        }
    }

    apply_size_constraints() {
        if (!this.resizable) {
            return;
        }
        let hdec = 0;
        const wdec = 0;
        let min_size = null;
        let max_size = null;
        const size_constraints = this.metadata["size-constraints"];
        if (size_constraints) {
            min_size = size_constraints["minimum-size"];
            max_size = size_constraints["maximum-size"];
        }
        let minw = null;
        let minh = null;
        if (min_size) {
            minw = min_size[0] + wdec;
            minh = min_size[1] + hdec;
        }
        let maxw = null;
        let maxh = null;
        if (max_size) {
            maxw = max_size[0] + wdec;
            maxh = max_size[1] + hdec;
        }
        if (minw > 0 && minw == maxw && minh > 0 && minh == maxh) {
            this.wnd.setControlBoxStyle(`WS_CBX_${this.canMinimize}CLOSE`);
            try {
                w96.WindowSystem.destroyResizeHandler(this.wnd);
            } catch (e) { }
        } else {
            this.wnd.setControlBoxStyle(`WS_CBX_${this.canMinimize}MAXCLOSE`);
        }
    }

    handle_resized() {
        const dims = this.div.getBoundingClientRect();
        const dimsBody = this.divBody.getBoundingClientRect();
        this.x = dims.x + this.leftoffset;
        this.y = dims.y + this.topoffset;
        this.w = dimsBody.width;
        this.h = Math.round(dimsBody.height) + this.wnd.maximized;
        // then update CSS and redraw backing
        this.updateCSSGeometry();

        if (this.maximized !== this.wnd.maximized) {
            this.maximized = this.wnd.maximized;
        }

        // send geometry callback
        this.geometry_cb(this);
    }

    handle_moved() {
        const dims = this.div.getBoundingClientRect();
        // add on padding to the event position so that
        // it reflects the internal geometry of the canvas
        this.x = dims.x + this.leftoffset;
        this.y = dims.y + this.topoffset;
        // make sure we are visible after move
        this.ensure_visible();
        // tell remote we have moved window
        this.geometry_cb(this);
    }

    eos() {
        // ...
    }

    set_maximized(maximized) {
        if (this.maximized === maximized) {
            return;
        }
        this.maximized = maximized;
        if (!this.wnd.maximized && maximized) this.wnd.toggleMaximize();
        if (this.wnd.maximized && !maximized) this.wnd.toggleMaximize();
    }

    set_metadata(metadata) {
        this.set_metadata_safe(metadata);
        // if ("fullscreen" in metadata) {
        //     this.set_fullscreen(metadata["fullscreen"] == 1);
        // }
        if ("maximized" in metadata) {
            this.set_maximized(metadata["maximized"] == 1);
        }
    }

    toggle_minimized() {
        //get the geometry before modifying the window:
        const geom = this.get_internal_geometry();
        this.set_minimized(!this.minimized);
        if (this.minimized) {
            this.client.send(["unmap-window", this.wid, true]);
            this.stacking_layer = 0;
            if (this.client.focus == this.wid) {
                this.client.auto_focus();
            }
        } else {
            this.client.send([
                "map-window",
                this.wid,
                geom.x,
                geom.y,
                geom.w,
                geom.h,
                this.client_properties,
            ]);
            //force focus switch:
            this.client.focus = -1;
            this.client.set_focus(this);
        }
    }

    set_minimized(minimized) {
        if (this.minimized == minimized) {
            return;
        }
        this.minimized = minimized;
    }

    screen_resized() {
        if (this.fullscreen || this.maximized) {
            this.fill_screen();
            this.handle_resized();
        }
        if (!this.ensure_visible()) {
            this.geometry_cb(this);
        }
    }

    fill_screen() {
        this.wnd.toggleMaximize();
        this.wnd.toggleMaximize();
    }

    initiate_moveresize(){
        // ...
    }
}
